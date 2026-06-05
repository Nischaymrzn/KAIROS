"""A/B measurement: one-hot encoding vs CatBoost's native categorical handling.

The production pipeline sends every classical model — CatBoost included — through
one shared `ColumnTransformer` (`StandardScaler` + `OneHotEncoder`,
`src/models/classical.py`). That means CatBoost's headline feature, **ordered target
statistics over raw categoricals**, has never been used, and `player_id` never
reaches the model at all (`features/build.py` excludes it from both the numeric and
categorical lists, though the deep models embed it via `DeepPrep`).

The 8-family comparison is still *fair* — every model got identical inputs — but the
absolute CatBoost figure may be understated. This measures the gap.

Variant A: CatBoost on the one-hot + scaled matrix (current production path).
Variant B: CatBoost on raw columns with `cat_features`, plus `player_id` as a
           categorical so ordered target statistics can learn a shooter effect.

Both variants get an identical budget, identical seeds and identical device, so the
only difference is the categorical treatment. **Test is never loaded.**

Counter-evidence to keep in mind while reading the result: the FT-Transformer *did*
embed `player_id` and still lost to CatBoost (0.6967 vs 0.6976), which suggests
player identity adds little beyond the derived skill features.

CLI:  python -m src.models.ab_catboost_cats [--seeds 2] [--iters 2000]
Output: reports/figures/ab_catboost_cats.json
"""
from __future__ import annotations
import argparse
import json
import time

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config

# identical budget for both arms; smaller than production so the paired comparison
# finishes in minutes — the contrast is what matters, not the absolute level
ITERS = 2000
LR = 0.03
DEPTH = 7
EARLY = 80


def _fit_onehot(train, val, feats, cats, seed, iters):
    from catboost import CatBoostClassifier
    from src.models.classical import make_preprocessor
    meta = {"numeric": [c for c in feats if c not in cats], "categorical": cats}
    pre = make_preprocessor(meta)
    Xtr = pre.fit_transform(train[feats]).astype("float32")
    Xva = pre.transform(val[feats]).astype("float32")
    m = CatBoostClassifier(iterations=iters, learning_rate=LR, depth=DEPTH,
                           task_type="CPU", random_seed=seed, verbose=False)
    m.fit(Xtr, train["MADE"], eval_set=(Xva, val["MADE"]),
          early_stopping_rounds=EARLY, verbose=False)
    return m.predict_proba(Xva)[:, 1], int(m.tree_count_)


def _fit_native(train, val, num, cats, seed, iters):
    from catboost import CatBoostClassifier, Pool
    cols = num + cats

    def prep(df):
        d = df[cols].copy()
        for c in cats:
            d[c] = d[c].astype("string").fillna("NA").astype(str)
        for c in num:
            d[c] = pd.to_numeric(d[c], errors="coerce").astype("float32")
        return d

    tr, va = prep(train), prep(val)
    idx = [cols.index(c) for c in cats]
    ptr = Pool(tr, train["MADE"], cat_features=idx)
    pva = Pool(va, val["MADE"], cat_features=idx)
    m = CatBoostClassifier(iterations=iters, learning_rate=LR, depth=DEPTH,
                           task_type="CPU", random_seed=seed, verbose=False)
    m.fit(ptr, eval_set=pva, early_stopping_rounds=EARLY, verbose=False)
    return m.predict_proba(pva)[:, 1], int(m.tree_count_)


def _paired_ci(y, pa, pb, n_boot=400, seed=42):
    rng = np.random.default_rng(seed)
    n = len(y)
    d = np.empty(n_boot)
    for i in range(n_boot):
        j = rng.integers(0, n, n)
        yj = y[j]
        d[i] = (np.nan if yj.min() == yj.max()
                else roc_auc_score(yj, pb[j]) - roc_auc_score(yj, pa[j]))
    d = d[~np.isnan(d)]
    return float(np.quantile(d, 0.025)), float(np.quantile(d, 0.975))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=2)
    ap.add_argument("--iters", type=int, default=ITERS)
    ap.add_argument("--boot", type=int, default=400)
    args = ap.parse_args()

    cfg = get_config()
    p = cfg.path("data_processed")
    meta = json.loads((p / "feature_meta.json").read_text())
    train = pd.read_parquet(p / "train.parquet")
    val = pd.read_parquet(p / "validation.parquet")

    cats = [c for c in meta["categorical"] if c in train.columns]
    num = [c for c in meta["numeric"] if c in train.columns]
    feats = num + cats
    # variant B additionally gets player_id as a native categorical
    cats_b = cats + (["player_id"] if "player_id" in train.columns else [])

    print(f"train {len(train):,}  val {len(val):,}  (test not loaded)")
    print(f"  {len(num)} numeric + {len(cats)} categorical; "
          f"variant B adds player_id ({train['player_id'].nunique()} levels)")

    y = val["MADE"].to_numpy()
    rows = []
    pa_last = pb_last = None
    for s in range(args.seeds):
        seed = cfg.seed + 97 * s
        t = time.time()
        pa, na = _fit_onehot(train, val, feats, cats, seed, args.iters)
        ta = time.time() - t
        t = time.time()
        pb, nb = _fit_native(train, val, num, cats_b, seed, args.iters)
        tb = time.time() - t
        r = {"seed": seed,
             "A_onehot_auc": float(roc_auc_score(y, pa)),
             "B_native_auc": float(roc_auc_score(y, pb)),
             "A_brier": float(brier_score_loss(y, pa)),
             "B_brier": float(brier_score_loss(y, pb)),
             "A_trees": na, "B_trees": nb,
             "A_seconds": round(ta, 1), "B_seconds": round(tb, 1)}
        r["d_auc"] = r["B_native_auc"] - r["A_onehot_auc"]
        r["d_brier"] = r["B_brier"] - r["A_brier"]
        rows.append(r)
        print(f"  seed {seed:4d}  one-hot {r['A_onehot_auc']:.5f} ({ta:.0f}s) | "
              f"native {r['B_native_auc']:.5f} ({tb:.0f}s) | "
              f"dAUC {r['d_auc']:+.5f}  dBrier {r['d_brier']:+.6f}")
        pa_last, pb_last = pa, pb

    d = np.array([r["d_auc"] for r in rows])
    db = np.array([r["d_brier"] for r in rows])
    lo, hi = _paired_ci(y, pa_last, pb_last, args.boot)
    keep = bool(d.mean() >= 0.001 or db.mean() < 0)
    out = {"runs": rows, "mean_d_auc": float(d.mean()),
           "mean_d_brier": float(db.mean()),
           "d_auc_range": [float(d.min()), float(d.max())],
           "sign_consistent_across_seeds": bool(np.all(d > 0) or np.all(d < 0)),
           "paired_bootstrap_ci95_d_auc": [lo, hi],
           "keep_rule": ">= +0.001 val AUC or improved val Brier",
           "verdict": "KEEP" if keep else "DROP (within noise)"}
    print(f"\n  mean dAUC {out['mean_d_auc']:+.5f}  "
          f"range [{d.min():+.5f}, {d.max():+.5f}]  "
          f"sign consistent: {out['sign_consistent_across_seeds']}")
    print(f"  mean dBrier {out['mean_d_brier']:+.6f}")
    print(f"  paired bootstrap 95% CI on dAUC [{lo:+.5f}, {hi:+.5f}]")
    print(f"  VERDICT: {out['verdict']}")
    fp = cfg.path("figures") / "ab_catboost_cats.json"
    fp.write_text(json.dumps(out, indent=2))
    print(f"  wrote {fp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
