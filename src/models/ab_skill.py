"""A/B measurement: raw vs empirical-Bayes player-skill features.

Applies the project's pre-registered keep rule — a change is adopted only if it
adds >= 0.001 validation AUC or improves validation Brier — and, per the lesson
learned when prior-season Basketball-Reference stats flipped sign across seeds,
runs **multiple seeds** and reports a **paired bootstrap CI on the delta** rather
than a single-run difference.

Variant A (current production behaviour, reproduced here so the comparison is
            apples-to-apples inside one harness):
    player_fg_pct = raw train group mean, league mean for unseen players
    player_3p_pct = same, over threes
    (no support counts, no imputation flags)

Variant B (proposed, src/features/skill.py):
    empirical-Bayes beta-binomial shrunk rates
  + player_fg_pct_support / player_3p_pct_support   (train attempts behind it)
  + player_fg_pct_is_imputed / player_3p_pct_is_imputed

**Test is never loaded.** Selection is a validation decision.

CLI:  python -m src.models.ab_skill [--seeds 3] [--boot 500]
Output: reports/figures/ab_skill.json
"""
from __future__ import annotations
import argparse
import json
import time

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config
from src.features.skill import shrunk_rates, apply_rates, describe

SKILL_COLS = ["player_fg_pct", "player_3p_pct"]
EXTRA_B = ["player_fg_pct_support", "player_3p_pct_support",
           "player_fg_pct_is_imputed", "player_3p_pct_is_imputed"]


def _raw_rates(train: pd.DataFrame) -> dict:
    """Variant A: exactly what features/build.py does today."""
    p_fg = train.groupby("player_id")["MADE"].mean()
    tr3 = train[train["is_3pt"] == 1]
    p_3p = tr3.groupby("player_id")["MADE"].mean()
    glob_fg = float(train["MADE"].mean())
    glob_3p = float(tr3["MADE"].mean()) if len(tr3) else glob_fg
    return {"fg": p_fg, "3p": p_3p, "glob_fg": glob_fg, "glob_3p": glob_3p}


def _apply_raw(part: pd.DataFrame, r: dict) -> None:
    part["player_fg_pct"] = (part["player_id"].map(r["fg"])
                             .fillna(r["glob_fg"]).astype("float32"))
    part["player_3p_pct"] = (part["player_id"].map(r["3p"])
                             .fillna(r["glob_3p"]).astype("float32"))


def _fit_predict(train, val, feats, cats, seed: int) -> np.ndarray:
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation
    from src.models.classical import make_preprocessor

    meta = {"numeric": [c for c in feats if c not in cats], "categorical": cats}
    pre = make_preprocessor(meta)
    Xtr = pre.fit_transform(train[feats]).astype("float32")
    Xva = pre.transform(val[feats]).astype("float32")
    m = LGBMClassifier(n_estimators=2000, learning_rate=0.03, num_leaves=95,
                       feature_fraction=0.8, bagging_fraction=0.8,
                       n_jobs=-1, random_state=seed, verbose=-1)
    m.fit(Xtr, train["MADE"], eval_set=[(Xva, val["MADE"])],
          callbacks=[early_stopping(80, verbose=False), log_evaluation(0)])
    return m.predict_proba(Xva)[:, 1]


def _support_bins(train: pd.DataFrame, part: pd.DataFrame):
    """Training attempts behind each row's shooter, binned. Added 2026-08-05 after
    `make robustness` found the ONLY calibration defect in the model sits exactly
    here: shooters with 1-50 training attempts are over-predicted by +0.0277.

    The original keep rule (aggregate val AUC / Brier) cannot see a defect confined
    to ~1.4% of rows, so the first run of this experiment measured the wrong thing.
    """
    sup = part["player_id"].map(train.groupby("player_id")["MADE"].count()).fillna(0)
    return pd.cut(sup, [-1, 0, 50, 200, 800, 10 ** 9],
                  labels=["0 (unseen)", "1-50", "51-200", "201-800", "800+"])


def _slice_gaps(y, p, bins) -> dict:
    """Calibration gap (mean predicted - observed) per support bin."""
    df = pd.DataFrame({"y": y, "p": p, "b": np.asarray(bins)})
    out = {}
    for level, sub in df.groupby("b", observed=True):
        out[str(level)] = {"n": int(len(sub)),
                           "gap": float(sub["p"].mean() - sub["y"].mean())}
    return out


def _paired_delta_ci(y, pa, pb, n_boot: int, seed: int = 42) -> tuple[float, float]:
    """95% CI on AUC(B) - AUC(A), resampling both on the SAME indices."""
    rng = np.random.default_rng(seed)
    n = len(y)
    d = np.empty(n_boot)
    for i in range(n_boot):
        j = rng.integers(0, n, n)
        yj = y[j]
        if yj.min() == yj.max():
            d[i] = np.nan
            continue
        d[i] = roc_auc_score(yj, pb[j]) - roc_auc_score(yj, pa[j])
    d = d[~np.isnan(d)]
    return float(np.quantile(d, 0.025)), float(np.quantile(d, 0.975))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--boot", type=int, default=500)
    args = ap.parse_args()

    cfg = get_config()
    p = cfg.path("data_processed")
    meta = json.loads((p / "feature_meta.json").read_text())
    train = pd.read_parquet(p / "train.parquet")
    val = pd.read_parquet(p / "validation.parquet")
    print(f"train {len(train):,}  val {len(val):,}  (test not loaded)")

    cats = [c for c in meta["categorical"] if c in train.columns]
    base_feats = [c for c in meta["numeric"] if c in train.columns] + cats

    # ---- variant A: raw group means (current production) -------------------
    raw = _raw_rates(train)
    for part in (train, val):
        _apply_raw(part, raw)
    feats_a = list(base_feats)

    # ---- variant B: empirical-Bayes shrunk + support + flags ---------------
    fg = shrunk_rates(train, mask=None)
    tp = shrunk_rates(train, mask=train["is_3pt"] == 1)
    print(" ", describe(fg, "player_fg_pct"))
    print(" ", describe(tp, "player_3p_pct"))

    b_train, b_val = train.copy(), val.copy()
    for part in (b_train, b_val):
        apply_rates(part, fg, "player_fg_pct")
        apply_rates(part, tp, "player_3p_pct")
    feats_b = list(base_feats) + [c for c in EXTRA_B if c in b_train.columns]

    # how much did shrinkage actually move the low-support players?
    sup = b_val["player_fg_pct_support"].to_numpy()
    moved = np.abs(b_val["player_fg_pct"].to_numpy() - val["player_fg_pct"].to_numpy())
    thin = sup < 100
    print(f"  val shots with <100 train attempts of support: {thin.mean():.2%}; "
          f"mean |shift| there {moved[thin].mean():.4f} vs "
          f"{moved[~thin].mean():.4f} elsewhere")
    print(f"  val shots flagged imputed (unseen shooter): "
          f"{b_val['player_fg_pct_is_imputed'].mean():.2%}")

    y = val["MADE"].to_numpy()
    rows = []
    pa_last = pb_last = None
    for s in range(args.seeds):
        seed = cfg.seed + 97 * s
        t = time.time()
        pa = _fit_predict(train, val, feats_a, cats, seed)
        pb = _fit_predict(b_train, b_val, feats_b, cats, seed)
        r = {
            "seed": seed,
            "A_auc": float(roc_auc_score(y, pa)),
            "B_auc": float(roc_auc_score(y, pb)),
            "A_brier": float(brier_score_loss(y, pa)),
            "B_brier": float(brier_score_loss(y, pb)),
            "seconds": round(time.time() - t, 1),
        }
        r["d_auc"] = r["B_auc"] - r["A_auc"]
        r["d_brier"] = r["B_brier"] - r["A_brier"]
        rows.append(r)
        print(f"  seed {seed:4d}  A {r['A_auc']:.5f}  B {r['B_auc']:.5f}  "
              f"dAUC {r['d_auc']:+.5f}  dBrier {r['d_brier']:+.6f}  ({r['seconds']}s)")
        pa_last, pb_last = pa, pb

    d_auc = np.array([r["d_auc"] for r in rows])
    d_bri = np.array([r["d_brier"] for r in rows])
    lo, hi = _paired_delta_ci(y, pa_last, pb_last, args.boot)

    # The defect this change was designed to fix is a SLICE calibration gap, which
    # aggregate AUC/Brier cannot detect. Judge it on its own terms too.
    bins = _support_bins(train, val)
    gaps_a = _slice_gaps(y, pa_last, bins)
    gaps_b = _slice_gaps(y, pb_last, bins)
    print("\n  calibration gap by shooter training support "
          "(the defect `make robustness` flagged):")
    print(f"    {'support':12} {'n':>8} {'A raw':>9} {'B shrunk':>10} {'change':>9}")
    for lvl in gaps_a:
        ga, gb = gaps_a[lvl]["gap"], gaps_b[lvl]["gap"]
        better = "better" if abs(gb) < abs(ga) else "worse"
        print(f"    {lvl:12} {gaps_a[lvl]['n']:8,} {ga:+9.4f} {gb:+10.4f} "
              f"{better:>9}")

    thin = "1-50"
    fixed = (thin in gaps_a and abs(gaps_b[thin]["gap"]) < abs(gaps_a[thin]["gap"]))

    signs_agree = bool(np.all(d_auc > 0) or np.all(d_auc < 0))
    keep = bool(d_auc.mean() >= 0.001 or d_bri.mean() < 0)

    out = {
        "runs": rows,
        "mean_d_auc": float(d_auc.mean()),
        "mean_d_brier": float(d_bri.mean()),
        "d_auc_range": [float(d_auc.min()), float(d_auc.max())],
        "sign_consistent_across_seeds": signs_agree,
        "paired_bootstrap_ci95_d_auc": [lo, hi],
        "keep_rule": ">= +0.001 val AUC or improved val Brier",
        "verdict": "KEEP" if keep else "DROP (within noise)",
        "slice_calibration_gap_raw": gaps_a,
        "slice_calibration_gap_shrunk": gaps_b,
        "fixes_low_support_calibration": bool(fixed),
        "prior_fg": {k: fg[k] for k in ("alpha", "beta", "prior_mean", "prior_strength")},
        "prior_3p": {k: tp[k] for k in ("alpha", "beta", "prior_mean", "prior_strength")},
    }
    print(f"\n  mean dAUC   {out['mean_d_auc']:+.5f}   "
          f"range [{d_auc.min():+.5f}, {d_auc.max():+.5f}]  "
          f"sign consistent: {signs_agree}")
    print(f"  mean dBrier {out['mean_d_brier']:+.6f}")
    print(f"  paired bootstrap 95% CI on dAUC [{lo:+.5f}, {hi:+.5f}]")
    print(f"  VERDICT: {out['verdict']}")

    fp = cfg.path("figures") / "ab_skill.json"
    fp.write_text(json.dumps(out, indent=2))
    print(f"  wrote {fp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
