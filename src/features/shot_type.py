"""Shot-type features from ACTION_TYPE / SHOT_TYPE (available in Tier A)."""
from __future__ import annotations
import pandas as pd


def _flag(s: pd.Series, *kw: str) -> "pd.Series":
    pat = "|".join(kw)
    return s.str.contains(pat, case=False, regex=True, na=False).astype("int8")


def add_shot_type(out: pd.DataFrame, src: pd.DataFrame, imputed: list) -> None:
    at = src["ACTION_TYPE"].astype("string").fillna("")
    out["action_type"] = src["ACTION_TYPE"].astype("category")
    out["is_3pt"] = (src["SHOT_TYPE"] == "3PT Field Goal").astype("int8")

    out["is_layup"] = _flag(at, "layup")
    out["is_dunk"] = _flag(at, "dunk")
    out["is_jump_shot"] = _flag(at, "jump shot")
    out["is_pullup"] = _flag(at, "pull")
    out["is_stepback"] = _flag(at, "step back")
    out["is_fadeaway"] = _flag(at, "fadeaway")
    out["is_turnaround"] = _flag(at, "turnaround")
    out["is_driving"] = _flag(at, "driving")          # drive indicator
    out["is_reverse"] = _flag(at, "reverse")
    out["is_putback"] = _flag(at, "putback", "tip")
    out["is_floater"] = _flag(at, "floating", "floater")
    out["is_hook"] = _flag(at, "hook")
    out["is_bank"] = _flag(at, "bank")
    # catch-and-shoot proxy: a plain jump shot that is not a pull-up/step-back
    out["is_catch_shoot"] = (
        (out["is_jump_shot"] == 1) & (out["is_pullup"] == 0) & (out["is_stepback"] == 0)
    ).astype("int8")
