"""Pre-shot movement proxies (dribbles before the shot, touch time). Public in
the 2014-15 shot logs, and touch time again in 2015-16 SportVU as time with the
ball; `src.data.contest` recovers both. Imputed and flagged elsewhere."""
from __future__ import annotations
import numpy as np
import pandas as pd

DEFAULTS = {"dribbles": 2.0, "touch_time": 2.5}


def _recovered(src: pd.DataFrame, col: str) -> pd.Series:
    if col in src.columns:
        return pd.to_numeric(src[col], errors="coerce")
    return pd.Series(np.nan, index=src.index, dtype="float64")


def add_movement_proxy(out: pd.DataFrame, src: pd.DataFrame, imputed: list) -> None:
    for feat, real_col in (("dribbles", "real_dribbles"),
                           ("touch_time", "real_touch_time")):
        vals = _recovered(src, real_col)
        out[feat] = vals.fillna(DEFAULTS[feat]).astype("float32").values
        out[f"{feat}_is_imputed"] = vals.isna().astype("int8").values

    out["dribble_rate"] = (out["dribbles"] /
                           out["touch_time"].clip(lower=0.1)).astype("float32")
    imputed += ["dribbles", "touch_time"]
