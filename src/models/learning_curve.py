"""Learning curve: does MORE shot data buy more accuracy?

Trains the production model family on increasing fractions of the training split
and evaluates each on the fixed validation season. If the curve has flattened at
100%, then adding more seasons (or more rows) cannot meaningfully raise AUC — the
model is bounded by the irreducible variance of shot outcomes, not by data volume.

This is the empirical answer to "should we train on all 22 seasons instead of 5?"

CLI:  python -m src.models.learning_curve
Outputs: reports/figures/learning_curve.png + learning_curve.json
"""
from __future__ import annotations
import json
import time

import numpy as np
from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config
from src.seeds import set_global_seed
from src.dataset import load_processed
from src.models.classical import make_preprocessor

FRACTIONS = [0.05, 0.10, 0.25, 0.50, 0.75, 1.00]


def _fit_eval(train, val, meta, cfg):
    """Fit preprocessor + LightGBM on `train`, score on `val`."""
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation
    pre = make_preprocessor(meta)
    Xtr = pre.fit_transform(train[meta["numeric"] + meta["categorical"]]).astype("float32")
    Xva = pre.transform(val[meta["numeric"] + meta["categorical"]]).astype("float32")
    ytr, yva = train["MADE"].to_numpy(), val["MADE"].to_numpy()

    p = cfg.models.lightgbm
    model = LGBMClassifier(
        n_estimators=p.n_estimators, learning_rate=p.learning_rate,
        num_leaves=p.num_leaves, feature_fraction=p.feature_fraction,
        bagging_fraction=p.bagging_fraction, n_jobs=p.n_jobs,
        random_state=cfg.seed)
    model.fit(Xtr, ytr, eval_set=[(Xva, yva)],
              callbacks=[early_stopping(80), log_evaluation(0)])
    pv = model.predict_proba(Xva)[:, 1]
    return roc_auc_score(yva, pv), brier_score_loss(yva, pv)


def _figure(rows, cfg):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    n = [r["n_train"] for r in rows]
    auc = [r["val_auc"] for r in rows]
    fig, ax = plt.subplots(figsize=(6.5, 4))
    ax.plot(n, auc, marker="o", color="#3b82f6")
    ax.set_xlabel("training shots")
    ax.set_ylabel("validation AUC")
    ax.set_title("Learning curve — does more shot data help?")
    ax.grid(alpha=0.3)
    ax.ticklabel_format(axis="x", style="plain")
    fig.tight_layout()
    fig.savefig(cfg.path("figures") / "learning_curve.png", dpi=130)
    plt.close(fig)


def main() -> int:
    cfg = get_config()
    set_global_seed(cfg.seed)
    ds = load_processed(cfg, with_test=False)
    rng = np.random.default_rng(cfg.seed)

    rows = []
    for f in FRACTIONS:
        if f < 1.0:
            idx = rng.choice(len(ds.train), size=int(f * len(ds.train)), replace=False)
            sub = ds.train.iloc[np.sort(idx)]
        else:
            sub = ds.train
        t = time.time()
        auc, brier = _fit_eval(sub, ds.val, ds.meta, cfg)
        dt = time.time() - t
        rows.append({"fraction": f, "n_train": int(len(sub)),
                     "val_auc": round(float(auc), 5),
                     "val_brier": round(float(brier), 5),
                     "seconds": round(dt, 1)})
        print(f"  {f:>5.0%}  n={len(sub):>7,}  val AUC {auc:.4f}  "
              f"Brier {brier:.4f}  ({dt:.0f}s)")

    _figure(rows, cfg)
    (cfg.path("figures") / "learning_curve.json").write_text(json.dumps(rows, indent=2))

    # how much did the last doubling of data buy?
    half = next(r for r in rows if r["fraction"] == 0.50)
    full = rows[-1]
    gain = full["val_auc"] - half["val_auc"]
    print(f"\n  Doubling data 50% -> 100% ({half['n_train']:,} -> {full['n_train']:,}) "
          f"bought {gain:+.4f} AUC.")
    print("  Extrapolated: another doubling would buy roughly the same or less.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
