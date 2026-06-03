"""Defensive features. Per-shot closest-defender distance is public for 2014-15
(shot logs) and 2015-16 (SportVU) only; `src.data.contest` recovers it for those
seasons and leaves NaN elsewhere, which is imputed here and flagged. Contest tier
is derived from the distance, so it varies only where the distance is real."""
from __future__ import annotations
import numpy as np
import pandas as pd

DEFENDER_DIST_IMPUTE = 4.0  # ft, league-typical "contested" default


def add_defensive(out: pd.DataFrame, src: pd.DataFrame, imputed: list) -> None:
    if "real_def_dist" in src.columns:
        vals = pd.to_numeric(src["real_def_dist"], errors="coerce")
    else:
        vals = pd.Series(np.nan, index=src.index, dtype="float64")

    out["defender_distance"] = vals.fillna(DEFENDER_DIST_IMPUTE).astype("float32").values
    out["defender_distance_is_imputed"] = vals.isna().astype("int8").values
    imputed.append("defender_distance")

    d = out["defender_distance"].to_numpy()
    contest = np.where(d < 2, "heavy",
              np.where(d < 4, "contested",
              np.where(d < 6, "light", "open")))
    out["contest_category"] = pd.Categorical(
        contest, categories=["heavy", "contested", "light", "open"]
    )
