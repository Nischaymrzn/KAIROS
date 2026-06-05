"""Spatial features (all available in Tier A from the shot coordinates)."""
from __future__ import annotations
import numpy as np
import pandas as pd

EPS = 1e-6


def add_spatial(out: pd.DataFrame, src: pd.DataFrame, imputed: list) -> None:
    out["shot_distance"] = src["SHOT_DISTANCE"].astype("float32")
    out["loc_x"] = src["LOC_X"].astype("float32")
    out["loc_y"] = src["LOC_Y"].astype("float32")
    out["abs_loc_x"] = src["LOC_X"].abs().astype("float32")  # side-agnostic
    # angle from the hoop (≈ origin in this coordinate system); 90° = straight on
    out["shot_angle_deg"] = np.degrees(
        np.arctan2(src["LOC_Y"].astype("float32"), src["LOC_X"].abs() + EPS)
    ).astype("float32")
    # side of court
    side = np.where(src["LOC_X"] < -7, "L", np.where(src["LOC_X"] > 7, "R", "C"))
    out["side"] = pd.Categorical(side)
    # zone categoricals
    out["basic_zone"] = src["BASIC_ZONE"].astype("category")
    out["zone_range"] = src["ZONE_RANGE"].astype("category")
