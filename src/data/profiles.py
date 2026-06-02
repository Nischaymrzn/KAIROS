"""Player profiles from the local NBA SQLite database.

`common_player_info` gives real height, weight, experience and draft position.
`draft_combine_stats` adds measured athleticism — wingspan, standing reach and
max vertical leap — for the ~60% of our shooters who attended the combine. These
are physical constants of the player, known long before any shot, so they carry
no leakage risk. Missing values are imputed and flagged downstream.
"""
from __future__ import annotations
import sqlite3

import numpy as np
import pandas as pd

from src.config import get_config


def _height_to_inches(h) -> float:
    """'6-10' -> 82.0 inches; blanks -> NaN."""
    try:
        ft, inch = str(h).split("-")
        return float(ft) * 12 + float(inch)
    except Exception:
        return np.nan


def load_profiles(cfg=None) -> pd.DataFrame:
    """Return a clean player-profile table keyed by PLAYER_ID (int)."""
    cfg = cfg or get_config()
    db = cfg.raw_path("sqlite")
    con = sqlite3.connect(str(db))
    cpi = pd.read_sql(
        "select person_id, height, weight, season_exp, position, draft_number "
        "from common_player_info", con)
    try:
        combine = pd.read_sql(
            "select player_id, wingspan, standing_reach, max_vertical_leap "
            "from draft_combine_stats", con)
    except Exception:  # table absent -> profiles still work
        combine = pd.DataFrame(columns=["player_id", "wingspan",
                                        "standing_reach", "max_vertical_leap"])
    con.close()

    out = pd.DataFrame()
    out["PLAYER_ID"] = pd.to_numeric(cpi["person_id"], errors="coerce")
    out = out.dropna(subset=["PLAYER_ID"])
    out["PLAYER_ID"] = out["PLAYER_ID"].astype("int64")
    out["prof_height_in"] = cpi["height"].map(_height_to_inches).values[: len(out)]
    out["prof_weight_lb"] = pd.to_numeric(cpi["weight"], errors="coerce").values[: len(out)]
    out["prof_experience"] = pd.to_numeric(cpi["season_exp"], errors="coerce").values[: len(out)]
    dn = pd.to_numeric(cpi["draft_number"], errors="coerce")
    out["prof_draft_number"] = dn.fillna(61).values[: len(out)]  # undrafted -> 61
    out = out.drop_duplicates("PLAYER_ID").reset_index(drop=True)

    # measured athleticism (combine); ~60% coverage, imputed+flagged downstream
    if len(combine):
        combine["PLAYER_ID"] = pd.to_numeric(combine["player_id"], errors="coerce")
        combine = combine.dropna(subset=["PLAYER_ID"])
        combine["PLAYER_ID"] = combine["PLAYER_ID"].astype("int64")
        for src, dst in (("wingspan", "prof_wingspan"),
                         ("standing_reach", "prof_standing_reach"),
                         ("max_vertical_leap", "prof_max_vertical")):
            combine[dst] = pd.to_numeric(combine[src], errors="coerce")
        combine = (combine[["PLAYER_ID", "prof_wingspan", "prof_standing_reach",
                            "prof_max_vertical"]]
                   .drop_duplicates("PLAYER_ID"))
        out = out.merge(combine, on="PLAYER_ID", how="left")
    return out
