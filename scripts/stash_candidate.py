"""Preserve a trained candidate that did not pass the promotion gate, then put
the workspace back on the frozen production version.

The workspace (`models/` root + `data/processed/feature_meta.json`) is what the
serving layer reads first, so after a retrain it is serving the candidate even
when `production/latest.json` still names the incumbent. That mismatch is
invisible and would quietly put unpromoted numbers behind the dashboard. This
script makes the two agree again, without throwing the candidate away.

CLI:  python -m scripts.stash_candidate --name v8
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import date
from pathlib import Path

from src.config import get_config

ARTIFACTS = ["calibrated_best.joblib", "zone_fg.joblib", "player_freq.joblib",
             "player_lookup.joblib", "player_skill.joblib", "era_table.joblib",
             "leaderboard.json", "catboost.joblib", "xgboost.joblib",
             "lightgbm.joblib", "rf.joblib", "logreg.joblib", "mlp.joblib",
             "fttransformer.joblib", "tabnet.joblib"]

# what serving reads, and therefore what has to be put back
SERVING = ["calibrated_best.joblib", "zone_fg.joblib", "player_freq.joblib",
           "player_lookup.joblib"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True, help="candidate name, e.g. v8")
    ap.add_argument("--reason", default="", help="why it was not promoted")
    args = ap.parse_args()

    cfg = get_config()
    models = cfg.path("models")
    processed = cfg.path("data_processed")
    prod_root = models / "production"
    incumbent = json.loads((prod_root / "latest.json").read_text())["version"]
    inc_dir = prod_root / f"v{incumbent}"

    dst = models / "candidates" / args.name
    dst.mkdir(parents=True, exist_ok=True)

    saved = []
    for rel in ARTIFACTS:
        src = models / rel
        if src.exists():
            shutil.copy2(src, dst / rel)
            saved.append(rel)
    meta_fp = processed / "feature_meta.json"
    if meta_fp.exists():
        shutil.copy2(meta_fp, dst / "feature_meta.json")
        saved.append("feature_meta.json")

    metrics_fp = cfg.path("figures") / "final_metrics.json"
    metrics = json.loads(metrics_fp.read_text()) if metrics_fp.exists() else {}
    meta = json.loads((dst / "feature_meta.json").read_text()) if meta_fp.exists() else {}
    (dst / "manifest.json").write_text(json.dumps({
        "candidate": args.name,
        "date": date.today().isoformat(),
        "promoted": False,
        "held_behind": f"v{incumbent}",
        "reason": args.reason,
        "test_metrics": metrics.get("test", {}),
        "baseline_test": metrics.get("baseline_test", {}),
        "n_train": meta.get("n_train"),
        "train_seasons": meta.get("train_seasons"),
        "n_features": len(meta.get("numeric", [])) + len(meta.get("categorical", [])),
        "files": saved,
    }, indent=2))
    print(f"  stashed {len(saved)} artifacts -> {dst}")

    # put the workspace back on the incumbent so serving matches production
    restored = []
    for rel in SERVING:
        src = inc_dir / rel
        if src.exists():
            shutil.copy2(src, models / rel)
            restored.append(rel)
    inc_meta = inc_dir / "feature_meta.json"
    if inc_meta.exists():
        shutil.copy2(inc_meta, meta_fp)
        restored.append("feature_meta.json")

    # the incumbent's own base model, whatever family it was
    inc_manifest = json.loads((inc_dir / "manifest.json").read_text())
    base = f"{inc_manifest['model']}.joblib"
    if (inc_dir / base).exists():
        shutil.copy2(inc_dir / base, models / base)
        restored.append(base)

    print(f"  restored {len(restored)} artifacts from v{incumbent} into the workspace")
    print(f"  serving now matches production v{incumbent}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
