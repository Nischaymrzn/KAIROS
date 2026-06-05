"""Situational / game-state features.

Score margin and home/away come from the local play-by-play, and opponent
context from box-score totals (both attached in `src.data.merge`). When a source
is absent the value is imputed and flagged, so the pipeline still runs Tier-A.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

# neutral fills for unmatched rows (league-average scale; the *_is_imputed flag
# lets the model discount them). Kept simple/constant to avoid split leakage.
_DEF_RATING_FILL = 111.0
_PACE_FILL = 100.0


def _real_or_imputed(out, src, col, feat, fill, imputed):
    """Copy a real enrichment column if present (NaN -> fill + flag), else set a
    fully-imputed constant. Returns nothing; writes feat + feat_is_imputed."""
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


def add_situational(out: pd.DataFrame, src: pd.DataFrame, imputed: list) -> None:
    # score margin (signed, shooter perspective) — real from PBP when available
    _real_or_imputed(out, src, "SCORE_MARGIN", "score_margin", 0.0, imputed)

    # home indicator — real (team abbreviation vs HOME_TEAM) when available
    if "IS_HOME" in src.columns:
        out["is_home"] = pd.to_numeric(src["IS_HOME"], errors="coerce").fillna(0).astype("int8")
        out["is_home_is_imputed"] = np.int8(0)
    else:
        out["is_home"] = np.int8(0)
        out["is_home_is_imputed"] = np.int8(1)
        imputed.append("is_home")

    # opponent context (defending team's season-to-date profile, prior games only)
    _real_or_imputed(out, src, "OPP_DEF_RATING", "opp_def_rating", _DEF_RATING_FILL, imputed)
    _real_or_imputed(out, src, "OPP_PACE", "opp_pace", _PACE_FILL, imputed)

    # clutch: last 5 minutes of Q4/OT within 5 points (now uses the real margin)
    late = (out["period"] >= 4) & (out["game_clock_sec"] <= 300)
    close = out["score_margin"].abs() <= 5
    out["is_clutch"] = (late & close).astype("int8")
