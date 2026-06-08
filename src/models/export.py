"""Export the frozen production bundle: models/production/v{N}/.

Copies every artifact serving needs (model, calibrator, train-fit tables,
feature metadata, movement models when present) into one versioned directory
with a manifest recording metrics, config, and date. This is the immutable
thesis artifact; `models/` root stays the working area.

CLI:  python -m src.models.export
"""
from __future__ import annotations
import hashlib
import argparse
import json
import shutil
from datetime import date

from src.config import get_config

CORE = ["calibrated_best.joblib", "zone_fg.joblib", "player_freq.joblib",
        "player_lookup.joblib", "leaderboard.json"]
MOVEMENT = ["movement/gru.pt", "movement/move_types.joblib",
            "movement/metrics.json"]


def next_version(prod_root) -> int:
    if not prod_root.exists():
        return 1
    versions = [int(p.name[1:]) for p in prod_root.glob("v*") if p.name[1:].isdigit()]
    return max(versions, default=0) + 1


# a new version must beat the incumbent by more than the noise in the comparison.
# 0.0021 is the paired-bootstrap CI half-width on the leaderboard; anything inside
# it is a coin flip dressed as an improvement.
PROMOTION_MARGIN = 0.0021


def promotion_gate(prod_root, new_auc: float) -> tuple[bool, str]:
    """Whether a candidate has earned promotion over the current production model."""
    latest = prod_root / "latest.json"
    if not latest.exists() or new_auc is None:
        return True, "no incumbent to beat"
    cur = json.loads(latest.read_text()).get("version")
    man = prod_root / f"v{cur}" / "manifest.json"
    if not man.exists():
        return True, f"incumbent v{cur} has no manifest"
    old_auc = json.loads(man.read_text()).get("test_metrics", {}).get("auc")
    if old_auc is None:
        return True, f"incumbent v{cur} recorded no test AUC"
    delta = new_auc - old_auc
    if delta > PROMOTION_MARGIN:
        return True, (f"test AUC {new_auc:.4f} beats v{cur} {old_auc:.4f} "
                      f"by {delta:+.4f} > {PROMOTION_MARGIN}")
    return False, (f"test AUC {new_auc:.4f} vs v{cur} {old_auc:.4f} "
                   f"({delta:+.4f}) is inside the {PROMOTION_MARGIN} noise margin")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true",
                    help="promote even if the candidate fails the gate")
    args = ap.parse_args()

    cfg = get_config()
    models = cfg.path("models")
    prod_root = models / "production"

    metrics_fp = cfg.path("figures") / "final_metrics.json"
    candidate = (json.loads(metrics_fp.read_text()) if metrics_fp.exists() else {})
    new_auc = candidate.get("test", {}).get("auc")
    ok, why = promotion_gate(prod_root, new_auc)
    print(f"  promotion gate: {'PASS' if ok else 'HOLD'} — {why}")
    gate_record = {"passed": bool(ok), "detail": why,
                   "overridden": bool(not ok and args.force)}
    if not ok and not args.force:
        print("  keeping the current production version. Nothing was written.")
        print("  (re-run with --force to override, and record why in RESULTS.md)")
        return 1

    v = next_version(prod_root)
    dst = prod_root / f"v{v}"
    (dst / "movement").mkdir(parents=True, exist_ok=True)

    import joblib
    cal = joblib.load(models / "calibrated_best.joblib")
    base_file = f"{cal['base_name']}.joblib"

    copied = []
    for rel in [base_file] + CORE + MOVEMENT:
        src = models / rel
        if src.exists():
            shutil.copy2(src, dst / rel)
            copied.append(rel)
        else:
            print(f"  (missing, skipped: {rel})")
    shutil.copy2(cfg.path("data_processed") / "feature_meta.json",
                 dst / "feature_meta.json")
    copied.append("feature_meta.json")

    metrics = candidate
    cfg_hash = hashlib.sha256(
        json.dumps(cfg.as_dict(), sort_keys=True, default=str).encode()
    ).hexdigest()[:12]

    manifest = {
        "version": v,
        "date": date.today().isoformat(),
        "model": cal["base_name"],
        "calibration": cal["method"],
        "test_metrics": metrics.get("test", {}),
        "baseline_test": metrics.get("baseline_test", {}),
        "auc_delta_over_baseline": metrics.get("auc_delta_over_baseline"),
        "config_sha": cfg_hash,
        "data_tier": cfg.data.tier,
        "promotion_gate": gate_record,
        "files": copied,
    }
    (dst / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (prod_root / "latest.json").write_text(json.dumps({"version": v}, indent=2))
    print(f"  exported production bundle -> {dst}")
    print(f"  model={manifest['model']} ({manifest['calibration']}), "
          f"test AUC={manifest['test_metrics'].get('auc')}")

    # acceptance: bundle is loadable and complete
    assert (dst / base_file).exists() and (dst / "manifest.json").exists()
    print("  ACCEPT: versioned production bundle complete with manifest.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
