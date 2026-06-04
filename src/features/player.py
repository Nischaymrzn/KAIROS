"""Player features. Tier A: position + id only. Tier B adds REAL signal —
profiles (height/weight/experience/draft from SQLite) and tracking tendencies
(speed/drives/catch-shoot/pull-up/paint from the NBA API). Anything missing is
imputed and flagged. Train-fit player skill (FG%/3P%) is added in build.py."""
from __future__ import annotations
import numpy as np
import pandas as pd

# league-typical defaults when a value is unavailable
DEFAULTS = {
    "height_in": 78.0, "weight_lb": 215.0, "experience_yrs": 4.0,
    "draft_number": 30.0, "avg_speed": 4.3, "drives_pg": 6.0,
    "drive_fg_pct": 0.47, "catch_shoot_rate": 3.0, "catch_shoot_fg_pct": 0.38,
    "pull_up_rate": 3.0, "pull_up_fg_pct": 0.38, "paint_touches": 3.0,
    "touches": 45.0,
    # volume/fatigue measures from the same tracking feed (medians of the
    # 6,460 player-seasons in tracking_summary.parquet)
    "drive_pts": 1.0, "catch_shoot_pts": 1.9, "pull_up_pts": 0.7,
    "dist_miles": 1.4, "time_of_poss": 1.0, "paint_touch_fg_pct": 0.613,
    # measured athleticism (draft combine, ~60% coverage)
    "wingspan_in": 81.0, "standing_reach_in": 105.0, "max_vertical_in": 34.0,
}
# feature name -> source column in the merged frame (Tier B)
SOURCES = {
    "height_in": "prof_height_in", "weight_lb": "prof_weight_lb",
    "experience_yrs": "prof_experience", "draft_number": "prof_draft_number",
    "avg_speed": "trk_avg_speed", "drives_pg": "trk_drives",
    "drive_fg_pct": "trk_drive_fg_pct", "catch_shoot_rate": "trk_catch_shoot_fga",
    "catch_shoot_fg_pct": "trk_catch_shoot_fg_pct", "pull_up_rate": "trk_pull_up_fga",
    "pull_up_fg_pct": "trk_pull_up_fg_pct", "paint_touches": "trk_paint_touches",
    "touches": "trk_touches",
    "drive_pts": "trk_drive_pts", "catch_shoot_pts": "trk_catch_shoot_pts",
    "pull_up_pts": "trk_pull_up_pts", "dist_miles": "trk_dist_miles",
    "time_of_poss": "trk_time_of_poss",
    "paint_touch_fg_pct": "trk_paint_touch_fg_pct",
    "wingspan_in": "prof_wingspan", "standing_reach_in": "prof_standing_reach",
    "max_vertical_in": "prof_max_vertical",
}


def add_player(out: pd.DataFrame, src: pd.DataFrame, imputed: list) -> None:
    out["player_id"] = src["PLAYER_ID"].astype("int64")
    pg = src["POSITION_GROUP"].astype("string").fillna("F").str[0].str.upper()
    pg = pg.where(pg.isin(["G", "F", "C"]), "F")
    out["position_group"] = pd.Categorical(pg, categories=["G", "F", "C"])

    for feat, col in SOURCES.items():
        default = DEFAULTS[feat]
        if col in src.columns:
            vals = pd.to_numeric(src[col], errors="coerce")
            out[feat] = vals.fillna(default).astype("float32").values
            out[f"{feat}_is_imputed"] = vals.isna().astype("int8").values
        else:
            out[feat] = np.float32(default)
            out[f"{feat}_is_imputed"] = np.int8(1)
        imputed.append(feat)
