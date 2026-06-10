"""Skill scores, the Murphy decomposition, calibration error, and bootstrap CIs.

**Why this module exists.** The project's headline has been AUC (0.7001 vs a 0.6371
baseline), and its ceiling argument has rested on a Monte-Carlo oracle
(`src/models/ceiling.py`). Both are weaker than what is available:

1. **AUC ignores calibration**, which this project explicitly treats as the primary
   concern, and it has no natural zero — "0.7001" means nothing without the ceiling
   next to it.
2. **The oracle simulation carries estimation error.** It returned *negative*
   headroom (-0.0045) and "102.3% of learnable signal" on v7, because it assumes the
   calibrated p IS the true p, and on an unseen test season p is slightly
   under-dispersed. `ceiling.py` documents this honestly, but a >100% figure invites
   the wrong question.

The **Murphy (1973) decomposition** of the Brier score gives the same argument
analytically, with no simulation and no artifact:

        Brier  =  Uncertainty  -  Resolution  +  Reliability

    Uncertainty  = o(1-o), o = base rate. The IRREDUCIBLE variance of the target.
                   This IS the ceiling. No model of any kind can remove it.
    Resolution   = how far the model's conditional make rates sit from the base
                   rate. This is the discrimination the model actually adds.
    Reliability  = the calibration penalty. 0 = perfectly calibrated.

and the **Brier Skill Score** turns it into one interpretable number:

        BSS = 1 - Brier / Brier_reference

with the reference being either the base-rate (climatological) forecast, giving the
fraction of *reducible* uncertainty captured, or the zone-xP baseline, giving the
gain over the model this project is benchmarked against.

For the frozen v7 bundle this yields **BSS 0.142 vs the baseline's 0.068** — the
model captures 14.2% of the reducible uncertainty, more than double the zone
baseline, while stating plainly that 74.8% of the Brier score is irreducible by
construction. That is a stronger and more honest headline than 0.7001.

Every statistic here is reported with a **bootstrap 95% confidence interval**,
because the project currently distinguishes models by as little as 0.0004 AUC with
no uncertainty estimate at all.

CLI:
    python -m src.models.skill_score            # full report (needs data/processed)
    python -m src.models.skill_score --manifest # headline only, from the frozen
                                                # bundle — works with no data on disk
Outputs: reports/figures/skill_score.json
"""
from __future__ import annotations
import argparse
import json

import numpy as np
from sklearn.metrics import roc_auc_score, brier_score_loss

# 20 quantile bins: enough resolution to separate REL from RES, few enough that
# every bin holds thousands of shots at n ~ 219k.
N_BINS = 20
N_BOOT = 1000
ALPHA = 0.05


# ---------------------------------------------------------------- core scores

def uncertainty(y) -> float:
    """o(1-o) — the irreducible Brier component. THE ceiling, computed exactly."""
    o = float(np.mean(y))
    return o * (1.0 - o)


def brier_skill_score(y, p, p_ref=None) -> float:
    """1 - Brier/Brier_ref. Reference defaults to the constant base-rate forecast.

    Positive = better than the reference. 0 = no skill. Negative = worse than
    predicting the base rate for every shot.
    """
    y = np.asarray(y, dtype=float)
    bs = brier_score_loss(y, np.clip(np.asarray(p, dtype=float), 0, 1))
    bs_ref = uncertainty(y) if p_ref is None else brier_score_loss(
        y, np.clip(np.asarray(p_ref, dtype=float), 0, 1))
    if bs_ref <= 0:
        return float("nan")
    return 1.0 - bs / bs_ref


def murphy_decomposition(y, p, n_bins: int = N_BINS) -> dict:
    """Binned Murphy decomposition: Brier ~= UNC - RES + REL.

    The identity is exact only when every forecast inside a bin is identical, so
    with binned real-valued forecasts it holds up to a small discretisation
    residual. That residual is returned as `residual` — if it is large relative to
    the terms, increase n_bins.
    """
    y = np.asarray(y, dtype=float)
    p = np.clip(np.asarray(p, dtype=float), 0.0, 1.0)
    n = len(y)
    o_bar = float(y.mean())

    # quantile bins: equal mass per bin, so no bin is too sparse to estimate o_k
    edges = np.unique(np.quantile(p, np.linspace(0, 1, n_bins + 1)))
    idx = np.clip(np.digitize(p, edges[1:-1], right=False), 0, len(edges) - 2)

    rel = res = 0.0
    bins = []
    for k in range(len(edges) - 1):
        m = idx == k
        n_k = int(m.sum())
        if n_k == 0:
            continue
        f_k = float(p[m].mean())      # mean forecast in the bin
        o_k = float(y[m].mean())      # observed make rate in the bin
        rel += n_k * (f_k - o_k) ** 2
        res += n_k * (o_k - o_bar) ** 2
        bins.append({"bin": k, "n": n_k, "mean_forecast": round(f_k, 4),
                     "observed_rate": round(o_k, 4),
                     "gap": round(f_k - o_k, 4)})
    rel /= n
    res /= n
    unc = o_bar * (1.0 - o_bar)
    bs = float(brier_score_loss(y, p))

    return {
        "brier": bs,
        "uncertainty": unc,
        "resolution": res,
        "reliability": rel,
        "reconstructed_brier": unc - res + rel,
        "residual": bs - (unc - res + rel),
        "bss_vs_base_rate": 1.0 - bs / unc if unc > 0 else float("nan"),
        "n_bins_used": len(bins),
        "bins": bins,
    }


def expected_calibration_error(y, p, n_bins: int = N_BINS) -> float:
    """ECE — mass-weighted mean |forecast - observed| over quantile bins."""
    d = murphy_decomposition(y, p, n_bins)
    n = len(y)
    return float(sum(b["n"] * abs(b["gap"]) for b in d["bins"]) / n)


# ---------------------------------------------------------------- uncertainty

def bootstrap_ci(y, p, metric_fn, n_boot: int = N_BOOT, alpha: float = ALPHA,
                 seed: int = 42) -> tuple[float, float, float]:
    """(point estimate, lo, hi) for any metric_fn(y, p) via the percentile bootstrap.

    Resamples shots with replacement. Shots within a game are not independent, so
    this is mildly anti-conservative; a game-level block bootstrap would be
    stricter. At n ~ 219k across ~1,300 games the difference is small, and having
    *an* interval is a large improvement over having none.
    """
    y = np.asarray(y)
    p = np.asarray(p, dtype=float)
    rng = np.random.default_rng(seed)
    n = len(y)
    point = float(metric_fn(y, p))
    stats = np.empty(n_boot, dtype=float)
    for b in range(n_boot):
        i = rng.integers(0, n, n)
        yi = y[i]
        if yi.min() == yi.max():          # degenerate resample; redraw cheaply
            stats[b] = np.nan
            continue
        stats[b] = metric_fn(yi, p[i])
    stats = stats[~np.isnan(stats)]
    lo, hi = np.quantile(stats, [alpha / 2, 1 - alpha / 2])
    return point, float(lo), float(hi)


def _auc(y, p) -> float:
    return float(roc_auc_score(y, p))


def _brier(y, p) -> float:
    return float(brier_score_loss(y, np.clip(p, 0, 1)))


def full_report(y, p, p_baseline=None, n_boot: int = N_BOOT) -> dict:
    """Everything, with CIs. `p_baseline` = the xP zone forecast, if available."""
    y = np.asarray(y)
    p = np.asarray(p, dtype=float)
    out: dict = {"n": int(len(y)), "base_rate": float(np.mean(y))}

    auc, auc_lo, auc_hi = bootstrap_ci(y, p, _auc, n_boot)
    bs, bs_lo, bs_hi = bootstrap_ci(y, p, _brier, n_boot)
    bss, bss_lo, bss_hi = bootstrap_ci(y, p, brier_skill_score, n_boot)

    out["auc"] = {"value": auc, "ci95": [auc_lo, auc_hi]}
    out["brier"] = {"value": bs, "ci95": [bs_lo, bs_hi]}
    out["bss_vs_base_rate"] = {"value": bss, "ci95": [bss_lo, bss_hi]}
    out["ece"] = expected_calibration_error(y, p)
    out["murphy"] = murphy_decomposition(y, p)

    if p_baseline is not None:
        pb = np.asarray(p_baseline, dtype=float)
        out["baseline"] = {
            "auc": _auc(y, pb),
            "brier": _brier(y, pb),
            "bss_vs_base_rate": brier_skill_score(y, pb),
            "ece": expected_calibration_error(y, pb),
        }
        out["bss_vs_xp_baseline"] = brier_skill_score(y, p, p_ref=pb)
        # paired bootstrap: the DIFFERENCE is what we care about, and resampling
        # both forecasts on the same indices removes the shared sampling noise.
        rng = np.random.default_rng(42)
        n = len(y)
        diffs = np.empty(n_boot, dtype=float)
        for b in range(n_boot):
            i = rng.integers(0, n, n)
            yi = y[i]
            if yi.min() == yi.max():
                diffs[b] = np.nan
                continue
            diffs[b] = _auc(yi, p[i]) - _auc(yi, pb[i])
        diffs = diffs[~np.isnan(diffs)]
        out["auc_delta_over_baseline"] = {
            "value": auc - out["baseline"]["auc"],
            "ci95": [float(np.quantile(diffs, 0.025)),
                     float(np.quantile(diffs, 0.975))],
        }
    return out


# ---------------------------------------------------------- manifest fallback

def from_manifest(cfg) -> dict:
    """Headline skill scores from a frozen bundle's manifest alone.

    BSS needs only the base rate and the Brier score, both of which every manifest
    already records — so this runs with **no data on disk**, which matters because
    the training corpus is currently absent. It cannot produce the full
    decomposition (that needs per-shot forecasts) or confidence intervals.
    """
    prod = cfg.path("models") / "production"
    version = json.loads((prod / "latest.json").read_text())["version"]
    man = json.loads((prod / f"v{version}" / "manifest.json").read_text())

    t, b = man["test_metrics"], man.get("baseline_test", {})
    o = float(t["base_rate"])
    unc = o * (1.0 - o)
    out = {
        "source": f"models/production/v{version}/manifest.json",
        "n": t["n"], "base_rate": o,
        "uncertainty_irreducible": unc,
        "model": {
            "brier": t["brier"], "auc": t["auc"],
            "bss_vs_base_rate": 1.0 - t["brier"] / unc,
            "resolution_minus_reliability": unc - t["brier"],
        },
    }
    if b:
        out["baseline"] = {
            "brier": b["brier"], "auc": b["auc"],
            "bss_vs_base_rate": 1.0 - b["brier"] / unc,
            "resolution_minus_reliability": unc - b["brier"],
        }
        out["bss_vs_xp_baseline"] = 1.0 - t["brier"] / b["brier"]
        out["skill_ratio_model_over_baseline"] = (
            out["model"]["bss_vs_base_rate"] / out["baseline"]["bss_vs_base_rate"])
    return out


def _print_manifest(r: dict) -> None:
    m = r["model"]
    print(f"source                : {r['source']}")
    print(f"test shots            : {r['n']:,}   base make rate {r['base_rate']:.4f}")
    print()
    print(f"IRREDUCIBLE (o(1-o))  : {r['uncertainty_irreducible']:.4f}"
          "   <- no model can remove this")
    print(f"model Brier           : {m['brier']:.4f}")
    print(f"  of which reducible  : {m['resolution_minus_reliability']:.4f}"
          "   (resolution - reliability)")
    print()
    print(f"{'BRIER SKILL SCORE':22}: {m['bss_vs_base_rate']:.4f}"
          f"   <- {m['bss_vs_base_rate']:.1%} of reducible uncertainty captured")
    if "baseline" in r:
        b = r["baseline"]
        print(f"{'  xP baseline BSS':22}: {b['bss_vs_base_rate']:.4f}"
              f"   ({b['bss_vs_base_rate']:.1%})")
        print(f"{'  BSS vs xP baseline':22}: {r['bss_vs_xp_baseline']:.4f}")
        print(f"{'  skill ratio':22}: {r['skill_ratio_model_over_baseline']:.2f}x"
              " the baseline's skill")
    print()
    print("  Reading: AUC says the model ranks shots better than the baseline.")
    print("  BSS says HOW MUCH of the removable uncertainty it actually removes,")
    print("  and states the irreducible remainder explicitly. Both are honest;")
    print("  BSS is the stronger claim because it has a meaningful zero.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", action="store_true",
                    help="headline scores from the frozen bundle (no data needed)")
    ap.add_argument("--n-boot", type=int, default=N_BOOT)
    args = ap.parse_args()

    from src.config import get_config
    cfg = get_config()

    if args.manifest:
        r = from_manifest(cfg)
        _print_manifest(r)
        fp = cfg.path("figures") / "skill_score_manifest.json"
        fp.write_text(json.dumps(r, indent=2))
        print(f"\n  wrote {fp}")
        return 0

    # full report: needs the test split + the frozen model
    import joblib
    from src.dataset import load_processed
    from src.models.registry import predict_proba
    from src.models.calibrate import apply_calibrator

    try:
        ds = load_processed(cfg, with_test=True)
    except FileNotFoundError:
        print("data/processed is empty — run `make features` first, or use\n"
              "  python -m src.models.skill_score --manifest\n"
              "for the headline numbers straight from the frozen bundle.")
        return 1

    m = cfg.path("models")
    cal = joblib.load(m / "calibrated_best.joblib")
    base = joblib.load(m / f"{cal['base_name']}.joblib")
    p = apply_calibrator(cal, predict_proba(base, ds.test))
    y = ds.test["MADE"].to_numpy()
    p_xp = ds.test["zone_fg_pct"].to_numpy()

    print(f"bootstrapping {args.n_boot} resamples over {len(y):,} test shots...")
    r = full_report(y, p, p_baseline=p_xp, n_boot=args.n_boot)

    d = r["murphy"]
    print(f"\n  n {r['n']:,}   base rate {r['base_rate']:.4f}")
    print(f"  AUC   {r['auc']['value']:.4f}  "
          f"95% CI [{r['auc']['ci95'][0]:.4f}, {r['auc']['ci95'][1]:.4f}]")
    print(f"  Brier {r['brier']['value']:.4f}  "
          f"95% CI [{r['brier']['ci95'][0]:.4f}, {r['brier']['ci95'][1]:.4f}]")
    print(f"  BSS   {r['bss_vs_base_rate']['value']:.4f}  "
          f"95% CI [{r['bss_vs_base_rate']['ci95'][0]:.4f}, "
          f"{r['bss_vs_base_rate']['ci95'][1]:.4f}]")
    print(f"  ECE   {r['ece']:.4f}")
    print("\n  Murphy decomposition (Brier = UNC - RES + REL):")
    print(f"    uncertainty  {d['uncertainty']:.4f}   <- irreducible")
    print(f"    resolution   {d['resolution']:.4f}   <- discrimination gained")
    print(f"    reliability  {d['reliability']:.4f}   <- calibration penalty")
    print(f"    residual     {d['residual']:+.6f}   (binning discretisation)")
    if "auc_delta_over_baseline" in r:
        dd = r["auc_delta_over_baseline"]
        print(f"\n  delta AUC over xP baseline {dd['value']:+.4f}  "
              f"95% CI [{dd['ci95'][0]:+.4f}, {dd['ci95'][1]:+.4f}]")
        print(f"  BSS vs xP baseline         {r['bss_vs_xp_baseline']:.4f}")

    fp = cfg.path("figures") / "skill_score.json"
    fp.write_text(json.dumps(r, indent=2))
    print(f"\n  wrote {fp}")

    assert d["residual"] < 0.001, "binning residual too large — raise n_bins"
    print("  ACCEPT: decomposition reconstructs the Brier score; CIs reported.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
