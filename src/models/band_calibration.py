"""Per-support-band recalibration — a targeted fix for the one real slice defect.

`make robustness` found exactly one reproducible calibration defect in the frozen
model: shooters with **1-50 training attempts are under-predicted by ~2.5 points**
(test gap -0.0277, 95% CI [-0.0395, -0.0169], n=6,340; validation independently
-0.0238 — same sign on both splits).

`make ab-skill` showed the obvious feature-side fix does not work: empirical-Bayes
shrinkage improves that slice by ~22% but **degrades the unseen-shooter slice, which
is five times larger**, because it moves every player's estimate at once.

The defect is a *calibration* defect, so fix it in the *calibration* layer, where a
correction can be applied to one band without touching the others.

**Method.** On top of the existing global calibrator, fit one scalar log-odds offset
per support band:

    p' = sigmoid( logit(p) + delta_b )

`delta_b` is fitted by minimising log-loss on the calibration split (a strictly
proper scoring rule, so it optimises calibration rather than mean-matching). One
parameter per band — deliberately far less flexible than a per-band isotonic fit,
because the smallest band has only ~3.5k rows and a full isotonic curve there would
overfit.

**Shrinkage on the correction itself.** delta_b is pulled toward 0 by
`n_b / (n_b + PSEUDO)`, so a small band cannot swing its own correction on noise.
This is the same estimator-stabilising idea that failed as a *feature* fix and is
appropriate here, where it applies to a single scalar rather than to every row.

Fitted on validation, evaluated once on test, reported per band with bootstrap CIs.

CLI:  python -m src.models.band_calibration
Output: reports/figures/band_calibration.json
"""
from __future__ import annotations
import json

import joblib
import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from sklearn.metrics import roc_auc_score, brier_score_loss, log_loss

from src.config import get_config
from src.dataset import load_processed
from src.models.registry import predict_proba
from src.models.calibrate import apply_calibrator

# band edges on "training attempts behind this shooter's skill estimate"
BAND_EDGES = [-1, 0, 50, 200, 800, 10 ** 9]
BAND_LABELS = ["0 (unseen)", "1-50", "51-200", "201-800", "800+"]
PSEUDO = 2000.0      # pseudo-count shrinking each band's offset toward zero
EPS = 1e-6


def _logit(p):
    p = np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)
    return np.log(p / (1 - p))


def _sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


def support_bands(train: pd.DataFrame, part: pd.DataFrame) -> pd.Series:
    sup = part["player_id"].map(
        train.groupby("player_id")["MADE"].count()).fillna(0)
    return pd.cut(sup, BAND_EDGES, labels=BAND_LABELS)


def fit_offsets(y, p, bands, pseudo: float = PSEUDO) -> dict:
    """One shrunk log-odds offset per band, fitted by log-loss on (y, p)."""
    z = _logit(p)
    out = {}
    for lbl in BAND_LABELS:
        m = np.asarray(bands == lbl)
        n = int(m.sum())
        if n == 0:
            out[lbl] = {"n": 0, "delta_raw": 0.0, "delta": 0.0}
            continue
        yb, zb = np.asarray(y)[m], z[m]
        if yb.min() == yb.max():                 # degenerate band
            out[lbl] = {"n": n, "delta_raw": 0.0, "delta": 0.0}
            continue

        def nll(d, yb=yb, zb=zb):
            return log_loss(yb, _sigmoid(zb + d), labels=[0, 1])

        r = minimize_scalar(nll, bounds=(-2.0, 2.0), method="bounded")
        raw = float(r.x)
        shrunk = raw * (n / (n + pseudo))        # small bands cannot swing far
        out[lbl] = {"n": n, "delta_raw": raw, "delta": float(shrunk)}
    return out


def apply_offsets(p, bands, offsets: dict) -> np.ndarray:
    z = _logit(p).copy()
    b = np.asarray(bands).astype(object)
    for lbl, o in offsets.items():
        z[b == lbl] += o["delta"]
    return _sigmoid(z)


def _gap_ci(y, p, n_boot=400, seed=42):
    rng = np.random.default_rng(seed)
    n = len(y)
    g = np.empty(n_boot)
    for i in range(n_boot):
        j = rng.integers(0, n, n)
        g[i] = p[j].mean() - y[j].mean()
    return float(np.quantile(g, 0.025)), float(np.quantile(g, 0.975))


def _band_report(y, p, bands) -> list[dict]:
    rows = []
    for lbl in BAND_LABELS:
        m = np.asarray(bands == lbl)
        if m.sum() == 0:
            continue
        yb, pb = np.asarray(y)[m], np.asarray(p)[m]
        lo, hi = _gap_ci(yb, pb)
        rows.append({"band": lbl, "n": int(m.sum()),
                     "observed": float(yb.mean()), "predicted": float(pb.mean()),
                     "gap": float(pb.mean() - yb.mean()), "gap_ci95": [lo, hi],
                     "brier": float(brier_score_loss(yb, np.clip(pb, 0, 1)))})
    return rows


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--val-only", action="store_true",
                    help="fit on val_fit and evaluate on val_cal — decides whether "
                         "to adopt this WITHOUT reading the test season")
    args = ap.parse_args()

    cfg = get_config()
    ds = load_processed(cfg, with_test=not args.val_only)
    m = cfg.path("models")
    cal = joblib.load(m / "calibrated_best.joblib")
    base = joblib.load(m / f"{cal['base_name']}.joblib")

    if args.val_only:
        # Pure validation decision: split the validation season chronologically,
        # fit the offsets on the earlier games and evaluate on the later ones.
        # The test season is never loaded.
        from src.data.splits import split_validation
        va, te = split_validation(ds.val, 0.3)
        va, te = va.reset_index(drop=True), te.reset_index(drop=True)
        print("VALIDATION-ONLY mode: fit on val_fit, evaluate on val_cal "
              "(test season not loaded)")
    else:
        va, te = ds.val.reset_index(drop=True), ds.test.reset_index(drop=True)
    y_va, y_te = va["MADE"].to_numpy(), te["MADE"].to_numpy()
    p_va = np.asarray(apply_calibrator(cal, predict_proba(base, va)), float)
    p_te = np.asarray(apply_calibrator(cal, predict_proba(base, te)), float)

    b_va = support_bands(ds.train, va)
    b_te = support_bands(ds.train, te)

    print(f"fitting band offsets on validation (n={len(y_va):,}), "
          f"evaluating on test (n={len(y_te):,})")
    offsets = fit_offsets(y_va, p_va, b_va)
    print(f"\n  {'band':12} {'n(val)':>9} {'delta_raw':>10} {'delta(shrunk)':>14}")
    for lbl, o in offsets.items():
        print(f"  {lbl:12} {o['n']:9,} {o['delta_raw']:+10.4f} {o['delta']:+14.4f}")

    p_te_new = apply_offsets(p_te, b_te, offsets)

    before = _band_report(y_te, p_te, b_te)
    after = _band_report(y_te, p_te_new, b_te)
    print("\n  TEST calibration gap by band:")
    print(f"  {'band':12} {'n':>8} {'before':>9} {'after':>9} {'|gap| change':>14}")
    improved = 0
    for a, c in zip(before, after):
        better = abs(c["gap"]) < abs(a["gap"])
        improved += bool(better)
        print(f"  {a['band']:12} {a['n']:8,} {a['gap']:+9.4f} {c['gap']:+9.4f} "
              f"{'better' if better else 'worse':>14}")

    agg_before = {"auc": float(roc_auc_score(y_te, p_te)),
                  "brier": float(brier_score_loss(y_te, np.clip(p_te, 0, 1)))}
    agg_after = {"auc": float(roc_auc_score(y_te, p_te_new)),
                 "brier": float(brier_score_loss(y_te, np.clip(p_te_new, 0, 1)))}
    unc = float(y_te.mean() * (1 - y_te.mean()))
    agg_before["bss"] = 1 - agg_before["brier"] / unc
    agg_after["bss"] = 1 - agg_after["brier"] / unc

    print(f"\n  aggregate (test)   {'before':>10} {'after':>10} {'change':>10}")
    for k in ("auc", "brier", "bss"):
        d = agg_after[k] - agg_before[k]
        print(f"    {k:16} {agg_before[k]:10.5f} {agg_after[k]:10.5f} {d:+10.5f}")

    target = next(r for r in before if r["band"] == "1-50")
    target_after = next(r for r in after if r["band"] == "1-50")
    fixed = abs(target_after["gap"]) < abs(target["gap"])
    no_harm = agg_after["brier"] <= agg_before["brier"] + 1e-5

    out = {"offsets": offsets, "pseudo_count": PSEUDO,
           "test_bands_before": before, "test_bands_after": after,
           "aggregate_before": agg_before, "aggregate_after": agg_after,
           "target_band": "1-50",
           "target_gap_before": target["gap"], "target_gap_after": target_after["gap"],
           "bands_improved": improved, "bands_total": len(before),
           "verdict": ("KEEP" if (fixed and no_harm) else "DROP")}
    print(f"\n  target band 1-50: {target['gap']:+.4f} -> {target_after['gap']:+.4f}")
    print(f"  bands improved: {improved}/{len(before)}   "
          f"aggregate Brier not worsened: {no_harm}")
    print(f"  VERDICT: {out['verdict']}")

    fp = cfg.path("figures") / "band_calibration.json"
    fp.write_text(json.dumps(out, indent=2))
    print(f"  wrote {fp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
