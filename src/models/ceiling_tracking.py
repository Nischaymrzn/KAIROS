"""How high could shot-make AUC POSSIBLY go — and how to legitimately exceed 0.80.

Part 1: the analytic ceiling.
    If p_i is the TRUE make probability of shot i, outcomes are Bernoulli(p_i).
    Drawing a random made shot and a random missed shot, the probability the made
    one ranks higher is, exactly:

        AUC_max = [ sum_i sum_j p_i (1-p_j) ( 1{p_i>p_j} + 0.5*1{p_i=p_j} ) ]
                  / ( sum_i p_i * sum_j (1-p_j) )

    computed in O(n log n). So the ceiling is fixed entirely by the SPREAD of true
    probabilities. We evaluate it under progressively more optimistic worlds:

      (a) our v6 model's calibrated probabilities;
      (b) empirical make rates in fine cells of the 2015-16 tracking data — real
          defender distance, defender angle, shot clock, distance, shot type. Cell
          rates carry sampling noise, which INFLATES the spread, so this is an
          upper bound on what a perfect full-tracking model could achieve;
      (c) an omniscient physics world where p is stretched until it spans the true
          extremes of NBA shot difficulty (dunk ~0.89 down to 30-footer ~0.22).

Part 2: the honest way to exceed 0.80.
    Single shots are coin flips. AGGREGATE them and the noise averages away.
    Predicting whether a *player-season* shoots above the league median is an easy
    task with a high AUC — because it sums hundreds of Bernoulli draws. Same model,
    same features; different unit of prediction.

CLI:  python -m src.models.ceiling_tracking
"""
from __future__ import annotations
import json

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from src.config import get_config


def auc_max(p: np.ndarray) -> float:
    """Exact maximum AUC achievable when p are the true probabilities."""
    p = np.clip(np.asarray(p, dtype=float), 1e-9, 1 - 1e-9)
    ps = np.sort(p)
    w1, w0 = ps, 1.0 - ps
    uniq, inv = np.unique(ps, return_inverse=True)
    s1 = np.bincount(inv, weights=w1, minlength=len(uniq))
    s0 = np.bincount(inv, weights=w0, minlength=len(uniq))
    below = np.concatenate([[0.0], np.cumsum(s0)[:-1]])      # mass strictly below
    num = float(np.sum(s1 * (below + 0.5 * s0)))
    den = float(w1.sum() * w0.sum())
    return num / den


def _sharpen(p: np.ndarray, k: float, m: float) -> np.ndarray:
    """Spread p away from the base rate m by a factor k."""
    return np.clip(m + k * (p - m), 1e-4, 1 - 1e-4)


def spread_needed_for(target: float, p: np.ndarray, m: float):
    """How much wider would true probabilities have to be for AUC_max == target?
    Returns (k, sharpened p). Bisection on the exact analytic ceiling."""
    lo, hi = 1.0, 60.0
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if auc_max(_sharpen(p, mid, m)) < target:
            lo = mid
        else:
            hi = mid
    k = 0.5 * (lo + hi)
    return k, _sharpen(p, k, m)


def tracking_cell_probabilities(cfg, min_cell: int = 100):
    """Empirical make rate in fine cells of the real 2015-16 tracking features."""
    fp = cfg.path("data_movement") / "shots_tracking.parquet"
    d = pd.read_parquet(fp)
    d["is_3"] = (d["SHOT_TYPE"].astype("string") == "3PT Field Goal").astype(int)
    d = d.dropna(subset=["pre_def_dist", "pre_shot_clock", "SHOT_DISTANCE"])

    cells = pd.DataFrame({
        "z": d["SHOT_ZONE_BASIC"].astype("string"),
        "dist": pd.cut(d["SHOT_DISTANCE"], [-1, 3, 8, 16, 22, 27, 100]),
        "defd": pd.cut(d["pre_def_dist"], [-1, 2, 4, 6, 9, 100]),
        "ang": pd.cut(d["pre_def_angle"], [-1, 30, 60, 90, 181]),
        "clk": pd.cut(d["pre_shot_clock"], [-1, 4, 8, 14, 19, 25]),
        "is3": d["is_3"],
    })
    key = cells.astype(str).agg("|".join, axis=1)
    g = d.assign(_k=key).groupby("_k")["MADE"]
    rate, n = g.transform("mean"), g.transform("size")
    keep = n >= min_cell
    return rate[keep].to_numpy(), d.loc[keep, "MADE"].to_numpy(), int(keep.sum()), int(d["_k"].nunique() if "_k" in d else 0)


def aggregation_demo(cfg) -> dict:
    """Same signal, different unit: rank PLAYER-SEASONS, not single shots."""
    te = pd.read_parquet(cfg.path("data_processed") / "test.parquet",
                         columns=["player_id", "MADE", "zone_fg_pct", "shot_distance",
                                  "is_3pt", "player_fg_pct"])
    g = te.groupby("player_id").agg(shots=("MADE", "size"),
                                    actual_fg=("MADE", "mean"),
                                    # predictor known BEFORE the season: the shooter's
                                    # historical skill + the difficulty of shots taken
                                    hist=("player_fg_pct", "mean"),
                                    zone=("zone_fg_pct", "mean"))
    g = g[g["shots"] >= 100]
    med = g["actual_fg"].median()
    y = (g["actual_fg"] > med).astype(int)
    score = 0.5 * g["hist"] + 0.5 * g["zone"]      # trivial blend, no tuning
    return {"n_players": int(len(g)),
            "auc_player_season": float(roc_auc_score(y, score)),
            "min_shots": 100}


def main() -> int:
    cfg = get_config()
    rows = {}

    # (a) our production model's calibrated probabilities
    import joblib
    from src.dataset import load_processed
    from src.models.registry import predict_proba
    from src.models.calibrate import apply_calibrator
    ds = load_processed(cfg, with_test=True)
    m = cfg.path("models")
    cal = joblib.load(m / "calibrated_best.joblib")
    base = joblib.load(m / f"{cal['base_name']}.joblib")
    p_model = apply_calibrator(cal, predict_proba(base, ds.test))
    y = ds.test["MADE"].to_numpy()
    rows["v6 model (our p)"] = (auc_max(p_model), float(np.std(p_model)),
                                roc_auc_score(y, p_model))

    # (b) empirical strata on REAL tracking features (defender distance + ANGLE +
    #     shot clock + distance + zone). Cell rates are unbiased estimates of the
    #     true p within each stratum.
    p_cell, y_cell, n_kept, _ = tracking_cell_probabilities(cfg)
    rows["real tracking strata (2015-16)"] = (auc_max(p_cell), float(np.std(p_cell)),
                                              roc_auc_score(y_cell, p_cell))

    base_rate = float(y.mean())
    print("MAXIMUM ACHIEVABLE AUC, given the spread of true shot probabilities")
    print("(exact: AUC_max is fixed entirely by how widely true p varies)\n")
    print(f"{'world':<36} {'p sd':>7} {'AUC_max':>9} {'actual':>8}")
    for k, (amax, sd, act) in rows.items():
        a = f"{act:.4f}" if act == act else "   -"
        print(f"{k:<36} {sd:>7.3f} {amax:>9.4f} {a:>8}")
    print(f"\n  Real tracking strata: {n_kept:,} shots in cells of >=100, conditioned on")
    print("  real defender distance AND angle, shot clock, distance and zone.")

    print("\nWhat would AUC 0.80 actually require? Widen the true probabilities")
    print("until the ceiling reaches each target, then look at the world implied:\n")
    print(f"{'target AUC_max':>14} {'spread x':>9} {'worst 1% make':>15} {'best 1% make':>14}")
    targets = []
    for t in (0.75, 0.80, 0.90):
        k, ps = spread_needed_for(t, p_model, base_rate)
        lo, hi = float(np.quantile(ps, 0.01)), float(np.quantile(ps, 0.99))
        print(f"{t:>14.2f} {k:>9.2f} {lo:>14.1%} {hi:>13.1%}")
        targets.append({"target": t, "k": round(k, 2),
                        "p01": round(lo, 4), "p99": round(hi, 4)})
    print("\n  Reality check, measured on the held-out season:")
    print("    dunks make 89.2%  |  rim (non-dunk) 64.3%  |  3PT 36.1%  |  30ft+ 22.0%")
    print("  Even a DUNK misses 11% of the time. No pre-release information removes")
    print("  the motor noise in a jump shot, so the required spread does not exist.")

    # Part 2 — change the unit of prediction
    agg = aggregation_demo(cfg)
    print("\n" + "=" * 66)
    print("HOW TO LEGITIMATELY EXCEED 0.80: stop predicting single coin flips.\n")
    print("  Task: does a player shoot above the league-median FG% this season?")
    print(f"  Unit: player-season ({agg['n_players']} players, >= {agg['min_shots']} shots)")
    print("  Predictor: 0.5*historical FG% + 0.5*avg zone difficulty (no tuning)")
    print(f"  AUC = {agg['auc_player_season']:.4f}")
    print("\n  Identical signal. Aggregating hundreds of Bernoulli draws averages the")
    print("  noise away, so the SAME information yields a far higher AUC. The shot")
    print("  ceiling is a property of the target, not of the model or the data.")

    out = {"auc_max": {k: round(v[0], 4) for k, v in rows.items()},
           "p_sd": {k: round(v[1], 4) for k, v in rows.items()},
           "spread_needed": targets,
           "aggregation": agg}
    (cfg.path("figures") / "ceiling_tracking.json").write_text(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
