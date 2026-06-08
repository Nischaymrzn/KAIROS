"""Metrics, sliced metrics, and the reliability diagram."""
from __future__ import annotations
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import (roc_auc_score, brier_score_loss, log_loss,
                             accuracy_score)
from sklearn.calibration import calibration_curve


def metrics(y, p) -> dict:
    p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    return {
        "auc": float(roc_auc_score(y, p)),
        "brier": float(brier_score_loss(y, p)),
        "logloss": float(log_loss(y, p)),
        "accuracy": float(accuracy_score(y, (p >= 0.5).astype(int))),
        "base_rate": float(np.mean(y)),
        "n": int(len(y)),
    }


def sliced(y, p, group: pd.Series, name: str) -> pd.DataFrame:
    df = pd.DataFrame({"y": np.asarray(y), "p": np.asarray(p), "g": np.asarray(group)})
    rows = []
    for g, sub in df.groupby("g"):
        if sub["y"].nunique() < 2:
            continue
        rows.append({name: g, "n": len(sub),
                     "auc": roc_auc_score(sub["y"], sub["p"]),
                     "brier": brier_score_loss(sub["y"], sub["p"]),
                     "make_rate": sub["y"].mean()})
    return pd.DataFrame(rows).sort_values("n", ascending=False)


def defender_tier(df: pd.DataFrame) -> pd.Series | None:
    """Contest tier, or None when defender distance is the imputed constant.

    Across the production window per-shot defender distance does not exist, so the
    column is a constant (see features/groups.py: DEAD_CONSTANT_COLUMNS) and every
    shot falls in one bin. Slicing by it produced a single degenerate row that read
    as a real result. Return None so the caller omits the slice entirely rather
    than publishing a meaningless one.
    """
    if "defender_distance" not in df.columns:
        return None
    d = df["defender_distance"]
    if float(pd.to_numeric(d, errors="coerce").std(ddof=0) or 0.0) == 0.0:
        return None
    return pd.cut(d, [-1, 2, 4, 6, 100],
                  labels=["heavy", "contested", "light", "open"])


def reliability_fig(curves: dict, out: Path, title: str) -> None:
    plt.figure(figsize=(6, 6))
    for label, (y, p) in curves.items():
        frac, mean = calibration_curve(y, p, n_bins=10, strategy="quantile")
        plt.plot(mean, frac, marker="o", label=label)
    plt.plot([0, 1], [0, 1], "k--", alpha=0.5, label="perfect")
    plt.xlabel("predicted probability"); plt.ylabel("observed make rate")
    plt.title(title); plt.legend(); plt.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out, dpi=120); plt.close()


def final_evaluation() -> dict:
    """Single-use evaluation on the held-out TEST season. Reads test once."""
    import json
    import joblib
    from src.config import get_config
    from src.dataset import load_processed
    from src.models.registry import predict_proba
    from src.models.calibrate import apply_calibrator

    cfg = get_config()
    cal = joblib.load(cfg.path("models") / "calibrated_best.joblib")
    base = joblib.load(cfg.path("models") / f"{cal['base_name']}.joblib")
    ds = load_processed(cfg, with_test=True)
    te = ds.test
    y = te["MADE"].values

    p_model = apply_calibrator(cal, predict_proba(base, te))
    p_base = te["zone_fg_pct"].values
    m_model = metrics(y, p_model)
    m_base = metrics(y, p_base)

    te = te.copy()
    te["_pmodel"] = p_model
    sl = {
        "shot_type": sliced(y, p_model, te["SHOT_TYPE"], "shot_type"),
        "zone": sliced(y, p_model, te["basic_zone"], "zone"),
    }
    tier = defender_tier(te)
    if tier is not None:                      # omitted when contest is constant
        sl["defender_tier"] = sliced(y, p_model, tier, "defender_tier")
    if "is_clutch" in te.columns:             # dropped with the game_state group
        sl["clutch"] = sliced(
            y, p_model, te["is_clutch"].map({0: "normal", 1: "clutch"}), "clutch")

    reliability_fig(
        {"xP baseline": (y, p_base), f"{cal['base_name']} (calibrated)": (y, p_model)},
        cfg.path("figures") / "final_reliability.png",
        "Reliability — held-out test season")

    out = {
        "model": cal["base_name"], "calibration": cal["method"],
        "test": m_model, "baseline_test": m_base,
        "auc_delta_over_baseline": round(m_model["auc"] - m_base["auc"], 4),
        "sliced": {k: v.to_dict("records") for k, v in sl.items()},
    }
    (cfg.path("figures") / "final_metrics.json").write_text(json.dumps(out, indent=2))
    return out


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true", help="run the single test-season eval")
    ap.parse_args()
    out = final_evaluation()
    d = out["auc_delta_over_baseline"]
    print(f"TEST  {out['model']} ({out['calibration']}-calibrated)")
    print(f"  AUC   {out['test']['auc']:.4f}  vs baseline {out['baseline_test']['auc']:.4f}  "
          f"(delta {d:+.4f})")
    print(f"  Brier {out['test']['brier']:.4f}  vs baseline {out['baseline_test']['brier']:.4f}")
    print("  ACCEPT: test read once, delta over baseline reported with sign.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
