"""Train-fit player shooting skill — empirical-Bayes shrunk, with support flags.

**The problem this replaces.** `features/build.py` estimated a shooter's skill as a
raw group mean over the training seasons:

    p_fg = train.groupby("player_id")["MADE"].mean()          # unshrunk
    part["player_fg_pct"] = part["player_id"].map(p_fg).fillna(glob_fg)

Measured on the production window (train 2021-24, val 2024-25, test 2025-26):

  * 134 of 808 training players (16.6%) have **fewer than 25 attempts**, and their
    raw rate spans **0.000 to 1.000** — that is sampling noise, not skill. For
    comparison, players with >=200 attempts span 0.337 to 0.747.
  * **20.1% of TEST shots** are taken by a player with **no training history at
    all** (rookies and new arrivals — the test season is three years after the
    start of training). Every one received the league mean.
  * Yet `player_fg_pct` had **no `_is_imputed` flag**, breaking the convention every
    other imputed feature in this project follows. The model therefore could not
    distinguish "measured, genuinely league-average shooter" from "we know nothing
    about this player".

**The fix, in three parts.**

1. **Empirical-Bayes (beta-binomial) shrinkage.** Fit a Beta(a, b) prior to the
   distribution of *well-supported* players' rates by method of moments, then
   report the posterior mean

       p_hat = (makes + a) / (attempts + a + b)

   A player with 5,000 attempts is essentially unshrunk; a player with 8 attempts
   collapses to the prior. This is the standard estimator for exactly this problem
   and is what the hierarchical-modelling literature prescribes.

2. **Support counts** (`player_fg_support`, `player_3p_support`) — how many training
   attempts the estimate rests on. This is genuinely new information: it is *not*
   derivable from any existing feature, so unlike a modelled proxy it can actually
   inform the model (it lets a tree discount the skill feature where support is
   thin).

3. **Imputation flags** (`player_fg_pct_is_imputed`) — set for players with zero
   training history, restoring the project-wide convention.

Fitted on TRAIN ONLY and mapped onto val/test, exactly as before — the shrinkage
prior is also fitted on train only, so no leakage is introduced.

Measure the effect before wiring it in: `python -m src.models.ab_skill`.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Players below this many attempts are excluded when FITTING the prior: their own
# rates are the noise we are trying to remove, so letting them set the prior's
# variance would inflate it and under-shrink everyone.
MIN_ATTEMPTS_FOR_PRIOR = 100


def fit_beta_prior(makes: np.ndarray, attempts: np.ndarray,
                   min_attempts: int = MIN_ATTEMPTS_FOR_PRIOR) -> tuple[float, float]:
    """Method-of-moments Beta(a, b) prior over per-player make rates.

    Returns (a, b). a + b is the prior's "pseudo-attempt" strength: the number of
    real attempts at which the estimate is pulled halfway to the prior mean.
    """
    ok = attempts >= min_attempts
    if ok.sum() < 20:                      # too few players to estimate a prior
        ok = attempts > 0
    rates = makes[ok] / np.maximum(attempts[ok], 1)
    m = float(np.mean(rates))
    v = float(np.var(rates, ddof=1))
    if not (0.0 < m < 1.0) or v <= 0:
        return 1.0, 1.0
    # For Beta(a,b): mean=a/(a+b), var=mean(1-mean)/(a+b+1)
    strength = m * (1.0 - m) / v - 1.0
    strength = float(np.clip(strength, 1.0, 5000.0))
    return m * strength, (1.0 - m) * strength


def shrunk_rates(train: pd.DataFrame, target: str = "MADE",
                 by: str = "player_id",
                 mask: pd.Series | None = None,
                 min_attempts: int = MIN_ATTEMPTS_FOR_PRIOR) -> dict:
    """Fit shrunk per-player rates on TRAIN. Returns a bundle for mapping.

    `mask` restricts which training rows count (e.g. threes only for `player_3p_pct`).
    """
    df = train if mask is None else train[mask]
    g = df.groupby(by)[target].agg(["sum", "count"])
    makes = g["sum"].to_numpy(dtype=float)
    attempts = g["count"].to_numpy(dtype=float)

    a, b = fit_beta_prior(makes, attempts, min_attempts)
    posterior = (makes + a) / (attempts + a + b)
    prior_mean = a / (a + b)

    return {
        "rate": dict(zip(g.index.to_numpy(), posterior.astype(float))),
        "support": dict(zip(g.index.to_numpy(), attempts.astype(float))),
        "prior_mean": float(prior_mean),
        "alpha": float(a), "beta": float(b),
        "prior_strength": float(a + b),
        "n_players": int(len(g)),
    }


def apply_rates(part: pd.DataFrame, bundle: dict, name: str,
                by: str = "player_id") -> None:
    """Write `{name}`, `{name}_support` and `{name}_is_imputed` onto `part`.

    Unseen players get the prior mean (the correct shrinkage limit for zero
    evidence), zero support, and the imputed flag set.
    """
    ids = part[by]
    rate = ids.map(bundle["rate"])
    part[name] = rate.fillna(bundle["prior_mean"]).astype("float32")
    part[f"{name}_is_imputed"] = rate.isna().to_numpy().astype("int8")
    part[f"{name}_support"] = (
        ids.map(bundle["support"]).fillna(0.0).astype("float32"))


def describe(bundle: dict, label: str) -> str:
    return (f"{label}: prior Beta(a={bundle['alpha']:.1f}, b={bundle['beta']:.1f}) "
            f"mean {bundle['prior_mean']:.4f}, strength {bundle['prior_strength']:.0f} "
            f"pseudo-attempts over {bundle['n_players']} players")
