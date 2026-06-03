"""Era-context features, so a 2015 shot and a 2025 shot are not treated as
draws from the same distribution.

The 3-point share went from roughly 27% to 42% across this corpus. Per-shot
difficulty barely moved (make rate 0.449 to 0.475), but the shot *mix* did, and
a wide training window without era context is dragged toward a bygone style.
era_drift.py established that handling this recovers +0.0020 AUC over a naive
wide window.

Every league aggregate here is LAGGED to the previous season. Two reasons:

  1. `league_fg_pct` is derived from the outcome. Computing it from a season's
     own shots would put that season's aggregate make rate into its own feature
     row, which is target leakage on validation and test.
  2. Even for the non-outcome aggregates, a full-season figure is not knowable
     while the season is being played, so an unlagged value could not be served.

The lag makes all of them honest: season S is described by what the league
actually did in S-1, which is exactly what a deployed model would know. The
fitted table is persisted so the serving layer reproduces training exactly
instead of recomputing anything from a single request.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

ERA_FEATURES = ["season_year", "league_3pt_share", "league_mean_dist",
                "league_fg_pct", "dist_vs_era"]
LEAGUE_COLS = ["league_3pt_share", "league_mean_dist", "league_fg_pct"]


def season_year(season: pd.Series) -> pd.Series:
    """'2014-15' -> 2014, as a numeric index."""
    return pd.to_numeric(pd.Series(season).astype(str).str.slice(0, 4), errors="coerce")


def fit_era_table(src: pd.DataFrame, out: pd.DataFrame) -> dict:
    """Per-season league aggregates, shifted so season S carries S-1's values."""
    frame = pd.DataFrame({
        "SEASON": src["SEASON"].astype(str).values,
        "is_3pt": out["is_3pt"].values,
        "shot_distance": out["shot_distance"].values,
        "MADE": src["MADE"].values,
    })
    per = frame.groupby("SEASON").agg(
        league_3pt_share=("is_3pt", "mean"),
        league_mean_dist=("shot_distance", "mean"),
        league_fg_pct=("MADE", "mean"),
    ).sort_index()
    lagged = per.shift(1)
    # the earliest season has no predecessor; describe it by itself rather than
    # dropping it, which is the only place this concession is made
    lagged.iloc[0] = per.iloc[0]
    return {
        "table": {s: {c: float(lagged.loc[s, c]) for c in LEAGUE_COLS}
                  for s in lagged.index},
        "year0": int(season_year(pd.Series(lagged.index)).min()),
        "latest": str(lagged.index[-1]),
    }


def add_era(out: pd.DataFrame, src: pd.DataFrame, imputed: list, era: dict) -> None:
    """Add era context from a fitted table. Falls back to the newest season when
    the caller has no SEASON column, which is the serving case."""
    table, year0, latest = era["table"], era["year0"], era["latest"]

    if "SEASON" in src.columns:
        season = src["SEASON"].astype(str)
    else:
        season = pd.Series([latest] * len(src), index=src.index)

    out["season_year"] = (season_year(season).to_numpy(dtype="float32") - year0)

    fallback = {c: float(np.mean([v[c] for v in table.values()])) for c in LEAGUE_COLS}
    for c in LEAGUE_COLS:
        out[c] = season.map(lambda s: table.get(s, fallback)[c]).to_numpy(dtype="float32")

    out["dist_vs_era"] = (out["shot_distance"].to_numpy(dtype="float32")
                          - out["league_mean_dist"].to_numpy(dtype="float32"))


def recency_weight(season: pd.Series, decay: float, latest_year: float) -> np.ndarray:
    """decay ** (seasons before the most recent training season)."""
    yr = season_year(season).to_numpy(dtype="float64")
    return np.power(decay, np.maximum(latest_year - yr, 0.0)).astype("float32")
