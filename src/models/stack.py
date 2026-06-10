"""Stacked ensemble — a logistic meta-learner over the base models' validation
predictions. This is the "highest" combination available: it lets the models
correct each other. Trained without leakage (meta-features are validation-season
predictions; the meta-learner never sees the test season).

The base models must already be trained (`make train`). We load each bundle,
predict on val (to fit the meta-learner) and on test (to score it), and compare
the stack against the best single model.

CLI:  python -m src.models.stack
"""
from __future__ import annotations
import json

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config
from src.dataset import load_processed
from src.models.registry import predict_proba

# strongest, most decorrelated base learners (skip the weak / redundant ones)
BASE = ["catboost", "xgboost", "lightgbm", "fttransformer", "tabnet", "mlp"]


def main() -> int:
    cfg = get_config()
    ds = load_processed(cfg, with_test=True)
    mdir = cfg.path("models")
    yv = ds.val["MADE"].to_numpy()
    yt = ds.test["MADE"].to_numpy()

    names, Pv, Pt = [], [], []
    for name in BASE:
        fp = mdir / f"{name}.joblib"
        if not fp.exists():
            print(f"  ({name} not trained, skipped)")
            continue
        b = joblib.load(fp)
        Pv.append(predict_proba(b, ds.val))
        Pt.append(predict_proba(b, ds.test))
        names.append(name)
    Pv, Pt = np.column_stack(Pv), np.column_stack(Pt)

    print("base models (single) — val / test AUC:")
    singles = {}
    for j, n in enumerate(names):
        singles[n] = (roc_auc_score(yv, Pv[:, j]), roc_auc_score(yt, Pt[:, j]))
        print(f"  {n:14} {singles[n][0]:.4f} / {singles[n][1]:.4f}")

    # meta-learner fit on validation predictions only
    meta = LogisticRegression(max_iter=1000, C=1.0)
    meta.fit(Pv, yv)
    stack_v = meta.predict_proba(Pv)[:, 1]
    stack_t = meta.predict_proba(Pt)[:, 1]

    # simple mean ensemble as a reference
    mean_t = Pt.mean(axis=1)

    best_single = max(singles, key=lambda n: singles[n][0])
    print(f"\n  best single (by val): {best_single} "
          f"val {singles[best_single][0]:.4f} / test {singles[best_single][1]:.4f}")
    print(f"  mean ensemble:        test AUC {roc_auc_score(yt, mean_t):.4f}")
    print(f"  STACK (logreg meta):  val {roc_auc_score(yv, stack_v):.4f} / "
          f"test {roc_auc_score(yt, stack_t):.4f}  Brier {brier_score_loss(yt, stack_t):.4f}")
    print("  meta weights:", {n: round(float(w), 3) for n, w in zip(names, meta.coef_[0])})

    out = {"base_names": names,
           "singles_val_test": {n: [round(a, 4), round(b, 4)] for n, (a, b) in singles.items()},
           "stack_val_auc": round(float(roc_auc_score(yv, stack_v)), 4),
           "stack_test_auc": round(float(roc_auc_score(yt, stack_t)), 4),
           "mean_test_auc": round(float(roc_auc_score(yt, mean_t)), 4),
           "best_single": best_single,
           "meta_weights": {n: round(float(w), 4) for n, w in zip(names, meta.coef_[0])}}
    (cfg.path("figures") / "stack.json").write_text(json.dumps(out, indent=2))
    print("\n  wrote reports/figures/stack.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
