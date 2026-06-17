"""Coach service — how a shot should be DELIVERED, measured from tracking.

`gameplan.py` answers "how good is this shot" from distance and contest. That is
a shot-selection question. This answers the next one a coach actually has: given
that the shot is being taken, what should the player do with his feet and with
the ball. It is the half of coaching that shot charts cannot reach, and the
2015-16 SportVU corpus is the only public data that can.

Every number is an OBSERVED make rate over 19,022 aligned tracked releases. None
of it is a model output and none of it is a coaching cliche someone typed in.

CONDITIONING IS THE WHOLE METHOD. Pooled over all distances these signals are
worthless or actively backwards: shots released while sprinting make at 42.8 per
cent against 39.7 for shots released standing still, which reads as "shoot on the
move" and is really just "layups are sprinting shots and threes are set shots".
Conditioned on distance the same data says something a coach can use, and says
the opposite thing at the two ends of the floor.

WHAT THE CORPUS SAYS

Hold time, catch-and-shoot against holding the ball longer than a second:

    rim    54.4 -> 48.8      close  49.7 -> 40.9      mid    47.8 -> 40.4
    long2  43.5 -> 41.6      three  37.7 -> 33.6

Same direction in every band. Getting the ball out early is the most consistent
delivery finding in the data.

Feet at release, set against on the move:

    rim    49.8 -> 54.1      three  38.5 -> 33.6

That inversion is the useful part. Momentum helps into contact at the rim and
hurts from range, so "be set" and "attack downhill" are both right, at opposite
ends of the floor.

WHAT IS DELIBERATELY NOT HERE
Defender closing speed. Threes with a defender closing out make at 36.7 per cent
against 33.5 with the defender fading, which cannot mean closeouts help the
shooter. It means a closeout is evidence the shot was already open enough to
force a rotation. The confound runs the wrong way to fix by conditioning on
distance alone, so it is left out rather than shipped with a caveat nobody reads.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

import pandas as pd

from src.config import get_config
from backend.services.gameplan import DIST_BANDS, _band, ALIGN_TOL_FT, TRAJ

#: Seconds the ball is held before release.
HOLD_BANDS = [
    ("quick", 0.0, 0.4, "Catch and shoot"),
    ("short", 0.4, 1.0, "Under a second"),
    ("held", 1.0, 99.0, "Held over a second"),
]

#: Speed of the shooter at the moment of release, feet per second.
FEET_BANDS = [
    ("set", 0.0, 1.5, "Set"),
    ("drifting", 1.5, 4.0, "Drifting"),
    ("moving", 4.0, 99.0, "On the move"),
]

#: Below this a cell is reported but not used to draw a conclusion.
MIN_N = 120


@lru_cache(maxsize=1)
def _plays() -> pd.DataFrame:
    """One row per aligned play, at release, with delivery bands attached."""
    cfg = get_config()
    path = cfg.path("data_raw").parent / TRAJ
    if not path.exists():
        raise FileNotFoundError(f"tracked trajectories not found at {path}")
    df = pd.read_parquet(path)

    key = ["GAME_ID", "GAME_EVENT_ID"]
    ordered = df.sort_values("step")
    last = ordered.groupby(key).tail(1).set_index(key)
    ok = last[(last["basket_dist"] - last["SHOT_DISTANCE"]).abs() <= ALIGN_TOL_FT].copy()

    # How long the shooter had the ball before letting it go. Frames carry a
    # has_ball flag, so this is the span of the frames where he held it rather
    # than an assumption about when the possession started.
    held = df[df["has_ball"] > 0.5].groupby(key)["t"].agg(["min", "max"])
    ok = ok.join((held["max"] - held["min"]).rename("hold_secs"), how="left")

    ok["dband"] = ok["SHOT_DISTANCE"].map(lambda v: _band(float(v), DIST_BANDS))
    ok["hband"] = ok["hold_secs"].map(
        lambda v: _band(float(v), HOLD_BANDS) if pd.notna(v) else None)
    ok["fband"] = ok["speed"].map(lambda v: _band(float(v), FEET_BANDS))
    return ok


def _rates(col: str, bands) -> dict[str, dict[str, dict[str, float]]]:
    """Make rate and sample size per distance band, split by one delivery band."""
    ok = _plays()
    g = ok.groupby(["dband", col], observed=True)["SHOT_MADE_FLAG"].agg(["mean", "size"])
    out: dict[str, dict[str, dict[str, float]]] = {}
    for (d, b), row in g.iterrows():
        if b is None:
            continue
        out.setdefault(str(d), {})[str(b)] = {
            "makeRate": round(float(row["mean"]), 4),
            "n": int(row["size"]),
        }
    return out


def _swing(row: dict[str, dict[str, float]], good: str, bad: str) -> float | None:
    """Points of make rate between two delivery bands, when both are solid."""
    a, b = row.get(good), row.get(bad)
    if not a or not b or a["n"] < MIN_N or b["n"] < MIN_N:
        return None
    return round((a["makeRate"] - b["makeRate"]) * 100, 1)


def delivery(distance_ft: float) -> dict[str, Any]:
    """How this kind of shot is best delivered, from the tracked corpus."""
    hold = _rates("hband", HOLD_BANDS)
    feet = _rates("fband", FEET_BANDS)
    dband = _band(float(distance_ft), DIST_BANDS)

    hold_row = hold.get(dband, {})
    feet_row = feet.get(dband, {})

    # The rim/arc inversion is the finding worth stating outright, so it is
    # computed here rather than left for a reader to spot in the grid.
    rim_feet = feet.get("rim", {})
    three_feet = feet.get("three", {})

    return {
        "band": dband,
        "bandLabel": next(lbl for k, _, _, lbl in DIST_BANDS if k == dband),
        "hold": {
            "rows": hold_row,
            "swingPts": _swing(hold_row, "quick", "held"),
            "bands": [{"key": k, "label": lbl} for k, _, _, lbl in HOLD_BANDS],
        },
        "feet": {
            "rows": feet_row,
            "swingPts": _swing(feet_row, "set", "moving"),
            "bands": [{"key": k, "label": lbl} for k, _, _, lbl in FEET_BANDS],
        },
        "inversion": {
            "rimSetVsMoving": _swing(rim_feet, "set", "moving"),
            "threeSetVsMoving": _swing(three_feet, "set", "moving"),
        },
        "holdGrid": hold,
        "feetGrid": feet,
        "distanceBands": [{"key": k, "label": lbl} for k, _, _, lbl in DIST_BANDS],
        "totalPlays": int(len(_plays())),
        "minN": MIN_N,
        "source": "2015-16 SportVU tracked releases, observed outcomes",
    }
