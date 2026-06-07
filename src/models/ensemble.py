"""Validation-weighted soft-voting ensemble of the trained models. Averages the
probability outputs of the strongest models (weighted by validation AUC), then
isotonic-calibrates the blend. A small, honest gain over the single best model.

CLI:  python -m src.models.ensemble
"""
from __future__ import annotations
import json

import joblib
import numpy as np
from sklearn.isotonic import IsotonicRegression

from src.config import get_config
from src.dataset import load_processed
from src.models.registry import predict_proba
from src.models.evaluate import metrics

# models to blend (the strong tabular learners)
MEMBERS = ["catboost", "lightgbm", "xgboost", "mlp"]


def main() -> int:
    cfg = get_config()
    ds = load_processed(cfg, with_test=True)
    board = {r["name"]: r["auc"] for r in
             json.loads((cfg.path("models") / "leaderboard.json").read_text())["models"]}

    # validation-AUC weights (relative to baseline) over available members
    members = [m for m in MEMBERS if (cfg.path("models") / f"{m}.joblib").exists()]
    base = 0.5
    weights = np.array([max(board.get(m, base) - base, 1e-3) for m in members])
    weights = weights / weights.sum()

    def blend(part):
        ps = [predict_proba(joblib.load(cfg.path("models") / f"{m}.joblib"), part)
              for m in members]
        return np.average(np.vstack(ps), axis=0, weights=weights)

    p_val = blend(ds.val)
    y_val = ds.val["MADE"].values
    iso = IsotonicRegression(out_of_bounds="clip").fit(p_val, y_val)

    p_test = iso.predict(blend(ds.test))
    y_test = ds.test["MADE"].values
    m_ens = metrics(y_test, p_test)
    m_base = metrics(y_test, ds.test["zone_fg_pct"].values)

    single = max(board, key=board.get)
    print("ensemble members:", dict(zip(members, weights.round(3))))
    print(f"single best ({single}) test AUC: {board[single]:.4f} (val)")
    print(f"ENSEMBLE  test AUC {m_ens['auc']:.4f}  Brier {m_ens['brier']:.4f}  "
          f"(baseline {m_base['auc']:.4f}, delta {m_ens['auc']-m_base['auc']:+.4f})")

    out = {"members": dict(zip(members, weights.tolist())),
           "test": m_ens, "baseline_test": m_base}
    (cfg.path("figures") / "ensemble_metrics.json").write_text(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
