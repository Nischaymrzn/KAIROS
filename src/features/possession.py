"""Possession-context features (recovered from play-by-play, see
`src.data.pbp_context`). All values describe the state BEFORE the shot.

The shot-clock proxy carries a known systematic bias: possessions that begin on a
dead ball (made shot, free throw, period start) time from the event, whereas the
real clock starts a few seconds later when the ball is inbounded. Rather than
fudge a constant, we expose `poss_reset_type` so the model can learn the offset
per reset type.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

# neutral fills for unmatched rows; the *_is_imputed flag lets the model discount
_POSS_ELAPSED_FILL = 14.0     # ~ mean possession length at the shot
_SHOT_CLOCK_FILL = 12.0       # ~ real median shot clock at the shot (2014-15)
_SECS_PREV_FILL = 3.0

EVENT_NAMES = {1: "made", 2: "miss", 3: "ft", 4: "reb", 5: "tov", 6: "foul",
               7: "viol", 8: "sub", 9: "timeout", 10: "jump",
               12: "period_begin", 13: "period_end"}
_EVENT_CATS = sorted(set(EVENT_NAMES.values()) | {"other"})


def _num(out, src, col, feat, fill, imputed):
    if col in src.columns:
        v = pd.to_numeric(src[col], errors="coerce")
        miss = v.isna()
        out[feat] = v.fillna(fill).astype("float32")
        out[f"{feat}_is_imputed"] = miss.to_numpy().astype("int8")
        if bool(miss.any()):
            imputed.append(feat)
    else:
        out[feat] = np.float32(fill)
        out[f"{feat}_is_imputed"] = np.int8(1)
        imputed.append(feat)


def _event_cat(src, col) -> pd.Categorical:
    codes = pd.to_numeric(src[col], errors="coerce") if col in src.columns else None
    if codes is None:
        names = pd.Series(["other"] * len(src), index=src.index)
    else:
        names = codes.map(EVENT_NAMES).fillna("other")
    return pd.Categorical(names, categories=_EVENT_CATS)


def add_possession(out: pd.DataFrame, src: pd.DataFrame, imputed: list) -> None:
    # NOTE: the shot clock itself lives in features/temporal.py, which consumes the
    # same SHOT_CLOCK_PROXY column — kept there so there is exactly one shot_clock.
    _num(out, src, "POSS_ELAPSED", "poss_elapsed", _POSS_ELAPSED_FILL, imputed)
    _num(out, src, "SECS_SINCE_PREV_EVENT", "secs_since_prev_event",
         _SECS_PREV_FILL, imputed)

    if "IS_TRANSITION" in src.columns:
        out["is_transition"] = pd.to_numeric(
            src["IS_TRANSITION"], errors="coerce").fillna(0).astype("int8")
    else:
        out["is_transition"] = np.int8(0)

    out["poss_reset_type"] = _event_cat(src, "POSS_RESET_TYPE")
    out["prev_event_type"] = _event_cat(src, "PREV_EVENT_TYPE")


# ---- in-game rhythm ("hot hand") + team rest / fatigue --------------------
_RHYTHM_FILLS = {"PRIOR_ATTEMPTS": ("prior_attempts", 0.0),
                 "PRIOR_MAKES": ("prior_makes", 0.0),
                 "PRIOR_FG": ("prior_fg", 0.46),          # league make rate
                 "SECS_SINCE_LAST_SHOT": ("secs_since_last_shot", 300.0)}
_REST_FILLS = {"REST_DAYS": ("rest_days", 2.0),
               "IS_B2B": ("is_b2b", 0.0),
               "GAMES_LAST_7": ("games_last_7", 3.0)}


def add_rhythm(out: pd.DataFrame, src: pd.DataFrame, imputed: list) -> None:
    """Shooter's form earlier in THIS game (strictly prior shots)."""
    for col, (feat, fill) in _RHYTHM_FILLS.items():
        _num(out, src, col, feat, fill, imputed)


def add_rest(out: pd.DataFrame, src: pd.DataFrame, imputed: list) -> None:
    """Shooting team's rest going into the game (prior games only)."""
    for col, (feat, fill) in _REST_FILLS.items():
        _num(out, src, col, feat, fill, imputed)
