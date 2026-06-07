"""The irreducible AUC ceiling of shot-make prediction.

Why can't a shot-quality model reach AUC 0.90? Not for lack of data. A shot
outcome is a Bernoulli draw: given the true make probability p of a shot, the ball
goes in with probability p and misses with probability 1-p. Even an ORACLE that
knows every shot's true p exactly cannot rank makes above misses perfectly,
because two identical shots (same p) resolve differently by chance.

This module quantifies that ceiling:

1. **Oracle AUC.** Treat our calibrated test-set probabilities as the true p (the
   model is isotonic-calibrated, so this is a fair estimate). Simulate outcomes
   y ~ Bernoulli(p) and score AUC(p, y). That is the best AUC *any* model could
   achieve on this task with these true probabilities — a perfect model's score.

   **Caveat (important).** The oracle inherits the assumption that our calibrated p
   *is* the true probability. If p is slightly under-dispersed — which happens when
   the isotonic calibrator, fit on validation, meets a test season it never saw —
   the simulated outcomes are less separable than the real ones and the oracle can
   land *below* the model's actual AUC (observed on v6: oracle 0.6955 vs actual
   0.7000, an impossible "102% of learnable signal"). Treat the oracle as an
   estimate with roughly +/-0.005 of error. The defensible claim is "the model is at
   the ceiling within estimation error", NOT "N thousandths from perfect".

2. **What would AUC 0.80 / 0.90 require?** Sharpen the probability spread around
   the base rate, p' = clip(m + k*(p - m)), and solve for the k that yields the
   target oracle AUC. Then report what the sharpened world looks like: the make
   rate of the best and worst shots. If reaching 0.90 requires layups that go in
   99% of the time and threes that go in 2% of the time, the target is not a
   modelling goal — it is a different sport.

Any real model reporting AUC >= 0.80 on shot-make has leaked the outcome
(typically via post-release ball trajectory, or the shot's own scoring event).

CLI:  python -m src.models.ceiling
Outputs: reports/figures/ceiling.json
"""
from __future__ import annotations
import json

import joblib
import numpy as np
from sklearn.metrics import roc_auc_score

from src.config import get_config
from src.dataset import load_processed
from src.models.registry import predict_proba
from src.models.calibrate import apply_calibrator

N_SIMS = 25
TARGETS = (0.75, 0.80, 0.85, 0.90)


def oracle_auc(p: np.ndarray, rng: np.random.Generator, n_sims: int = N_SIMS) -> float:
    """Mean AUC obtained by a model that knows p exactly, against outcomes drawn
    from p. This is the theoretical maximum for these true probabilities."""
    aucs = []
    for _ in range(n_sims):
        y = (rng.random(len(p)) < p).astype(np.int8)
        if 0 < y.sum() < len(y):
            aucs.append(roc_auc_score(y, p))
    return float(np.mean(aucs))


def _sharpen(p: np.ndarray, k: float, m: float) -> np.ndarray:
    return np.clip(m + k * (p - m), 1e-4, 1 - 1e-4)


def k_for_target(p: np.ndarray, target: float, m: float,
                 rng: np.random.Generator) -> tuple[float, np.ndarray]:
    """Bisect on the sharpening factor k until the oracle AUC hits `target`."""
    lo, hi = 1.0, 200.0
    for _ in range(28):
        mid = (lo + hi) / 2
        a = oracle_auc(_sharpen(p, mid, m), rng, n_sims=6)
        if a < target:
            lo = mid
        else:
            hi = mid
    k = (lo + hi) / 2
    return k, _sharpen(p, k, m)


def main() -> int:
    cfg = get_config()
    rng = np.random.default_rng(cfg.seed)
    ds = load_processed(cfg, with_test=True)

    m = cfg.path("models")
    cal = joblib.load(m / "calibrated_best.joblib")
    base = joblib.load(m / f"{cal['base_name']}.joblib")
    p = apply_calibrator(cal, predict_proba(base, ds.test))
    y = ds.test["MADE"].to_numpy()

    actual = roc_auc_score(y, p)
    oracle = oracle_auc(p, rng)
    base_rate = float(y.mean())

    # "Is the model good?" is not "is AUC >= X". The meaningful question is what
    # fraction of the *learnable* discrimination it has captured. Random guessing
    # scores 0.5; a perfect model scores `oracle`. We report where we sit between.
    skill_captured = (actual - 0.5) / (oracle - 0.5)

    print(f"test shots            : {len(y):,}   base make rate {base_rate:.3f}")
    print("random guessing       : 0.5000")
    print(f"our model's AUC       : {actual:.4f}")
    print(f"ORACLE AUC (perfect p): {oracle:.4f}   <- the hard ceiling")
    print(f"headroom left to us   : {oracle - actual:+.4f}")
    print(f"SKILL CAPTURED        : {skill_captured:.1%} of all learnable signal")
    print(f"calibrated p range    : {p.min():.3f} .. {p.max():.3f} "
          f"(sd {p.std():.3f})")
    print()
    print("What would a higher AUC require? Sharpen the true probabilities until")
    print("an oracle reaches the target, then look at the world it implies:\n")
    print(f"{'target AUC':>10} {'sharpen k':>10} {'worst shot':>12} {'best shot':>11}")

    rows = []
    for t in TARGETS:
        if t <= oracle:
            print(f"{t:>10.2f} {'-':>10} {'(already reachable)':>25}")
            rows.append({"target_auc": t, "reachable_without_sharpening": True})
            continue
        k, ps = k_for_target(p, t, base_rate, rng)
        lo, hi = float(np.quantile(ps, 0.01)), float(np.quantile(ps, 0.99))
        print(f"{t:>10.2f} {k:>10.1f} {lo:>11.1%} {hi:>10.1%}")
        rows.append({"target_auc": t, "sharpen_k": round(k, 2),
                     "p1_make_rate": round(lo, 4), "p99_make_rate": round(hi, 4)})

    print("\n  Reading: to reach the target AUC, the *worst* 1% of shots would have")
    print("  to fall at the left rate and the *best* 1% at the right rate. Real NBA")
    print("  shots span roughly 23% (heavily contested 3) to 65% (open layup).")

    out = {"n_test": int(len(y)), "base_rate": round(base_rate, 4),
           "model_auc": round(float(actual), 4),
           "oracle_auc": round(oracle, 4),
           "headroom": round(float(oracle - actual), 4),
           "skill_captured": round(float(skill_captured), 4),
           "p_min": round(float(p.min()), 4), "p_max": round(float(p.max()), 4),
           "p_sd": round(float(p.std()), 4), "targets": rows}
    fp = cfg.path("figures") / "ceiling.json"
    fp.write_text(json.dumps(out, indent=2))
    print(f"\n  wrote {fp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
