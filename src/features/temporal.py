"""Temporal features. Game clock + period are in Tier A.

NBA_Shots has no shot clock, and the NBA does not publish per-shot shot clock for
2018-23. We therefore reconstruct it from the play-by-play possession stream
(`src.data.pbp_context`): the shot clock is the 24s (or 14s after an offensive
rebound) base minus the seconds elapsed since the possession began. Where the
join fails, the value is imputed and flagged, exactly as before.

Known bias: possessions that begin on a dead ball (made shot, free throw, period
start) are timed from the event, whereas the real clock starts when the ball is
inbounded a few seconds later. `poss_reset_type` (see `features/possession.py`)
lets the model learn that offset rather than us hard-coding a fudge.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

SHOT_CLOCK_IMPUTE = 12.0  # league-typical median when unknown


def add_temporal(out: pd.DataFrame, src: pd.DataFrame, imputed: list) -> None:
    out["period"] = src["QUARTER"].astype("int16")
    out["is_overtime"] = (src["QUARTER"] > 4).astype("int8")
    out["game_clock_sec"] = (
        src["MINS_LEFT"].astype("float32") * 60 + src["SECS_LEFT"].astype("float32")
    )

    # shot clock: real (reconstructed from PBP possessions) when available
    if "SHOT_CLOCK_PROXY" in src.columns:
        v = pd.to_numeric(src["SHOT_CLOCK_PROXY"], errors="coerce")
        miss = v.isna()
        out["shot_clock"] = v.fillna(SHOT_CLOCK_IMPUTE).astype("float32")
        out["shot_clock_is_imputed"] = miss.to_numpy().astype("int8")
        if bool(miss.any()):
            imputed.append("shot_clock")
    else:
        out["shot_clock"] = np.float32(SHOT_CLOCK_IMPUTE)
        out["shot_clock_is_imputed"] = np.int8(1)
        imputed.append("shot_clock")

    # non-linear urgency (last 5 seconds up-weighted)
    sc = out["shot_clock"].to_numpy()
    out["shot_clock_urgency"] = np.where(
        sc < 5, ((5 - sc) / 5) ** 2, 0.0
    ).astype("float32")
