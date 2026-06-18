"""Game plan: what real tracked players did in this situation, and how it went.

This replaces a replay viewer. Watching one possession is entertaining and tells
you nothing; the same corpus aggregated tells you how to play.

Every number here is an OBSERVED make rate from the 2015-16 SportVU season, not a
model output. Only plays whose tracking agrees with the shot record are counted
(see replay.py for that filter), so a release frame really is the release.

The finding the grid exists to show, measured over 19,022 tracked plays:

              tight(<3ft)  contested(3-6)  open(>6)
    rim            48.0          52.5        53.5
    close          41.3          43.4        43.1
    mid            38.7          42.5        46.2
    long two       32.4          39.0        43.4
    three          22.9          32.7        37.8

Contest is worth about five points at the rim and about FIFTEEN on a three. A
hand in the face barely changes a layup, because that shot is taken into contact
by design, and it is close to decisive from range. Conditioning on distance is
what makes that visible: pooled across all distances the contest effect nearly
vanishes, because tightly guarded shots are mostly layups and open shots are
mostly threes, and the two biases cancel.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

import pandas as pd

from src.config import get_config

TRAJ = "movement/trajectories.parquet"
ALIGN_TOL_FT = 3.0

#: Shot distance bands, in feet, with the label a person would use.
DIST_BANDS = [
    ("rim", 0.0, 4.0, "At the rim"),
    ("close", 4.0, 10.0, "Close range"),
    ("mid", 10.0, 16.0, "Mid range"),
    ("long2", 16.0, 22.0, "Long two"),
    ("three", 22.0, 50.0, "Three"),
]

#: Contest bands, on the closest defender at release.
CONTEST_BANDS = [
    ("tight", 0.0, 3.0, "Tight"),
    ("contested", 3.0, 6.0, "Contested"),
    ("open", 6.0, 100.0, "Open"),
]


def _band(value: float, bands) -> str:
    for key, lo, hi, _ in bands:
        if lo <= value < hi:
            return key
    return bands[-1][0]


@lru_cache(maxsize=1)
def _release_frames() -> pd.DataFrame:
    """One row per aligned play, at the moment of release."""
    cfg = get_config()
    path = cfg.path("data_raw").parent / TRAJ
    if not path.exists():
        raise FileNotFoundError(f"tracked trajectories not found at {path}")
    df = pd.read_parquet(path)
    last = df.sort_values("step").groupby(["GAME_ID", "GAME_EVENT_ID"]).tail(1)
    ok = last[(last["basket_dist"] - last["SHOT_DISTANCE"]).abs() <= ALIGN_TOL_FT].copy()
    ok["dband"] = ok["SHOT_DISTANCE"].map(lambda v: _band(float(v), DIST_BANDS))
    ok["cband"] = ok["def_dist"].map(lambda v: _band(float(v), CONTEST_BANDS))
    return ok


@lru_cache(maxsize=1)
def _grid() -> dict[str, dict[str, dict[str, float]]]:
    """Make rate and sample size for every distance-by-contest cell."""
    ok = _release_frames()
    g = ok.groupby(["dband", "cband"], observed=True)["SHOT_MADE_FLAG"].agg(["mean", "size"])
    out: dict[str, dict[str, dict[str, float]]] = {}
    for (d, c), row in g.iterrows():
        out.setdefault(str(d), {})[str(c)] = {
            "makeRate": round(float(row["mean"]), 4),
            "n": int(row["size"]),
        }
    return out


def plan(distance_ft: float, defender_ft: float | None) -> dict[str, Any]:
    """What happened to real players taking this shot under this pressure."""
    grid = _grid()
    dband = _band(float(distance_ft), DIST_BANDS)
    cband = _band(float(defender_ft if defender_ft is not None else 99.0), CONTEST_BANDS)
    cell = grid.get(dband, {}).get(cband)

    row = grid.get(dband, {})
    tight = row.get("tight", {}).get("makeRate")
    open_ = row.get("open", {}).get("makeRate")
    # what getting open is worth at THIS range, in points of make rate
    contest_value = (
        round((open_ - tight) * 100, 1) if tight is not None and open_ is not None else None
    )

    # the same figure at the rim, as the contrast that carries the lesson
    rim = grid.get("rim", {})
    rim_tight = rim.get("tight", {}).get("makeRate")
    rim_open = rim.get("open", {}).get("makeRate")
    rim_value = (
        round((rim_open - rim_tight) * 100, 1)
        if rim_tight is not None and rim_open is not None
        else None
    )

    return {
        "band": dband,
        "bandLabel": next(lbl for k, _, _, lbl in DIST_BANDS if k == dband),
        "contest": cband,
        "contestLabel": next(lbl for k, _, _, lbl in CONTEST_BANDS if k == cband),
        "observed": cell,
        "contestValuePts": contest_value,
        "rimContestValuePts": rim_value,
        "grid": grid,
        "bands": {
            "distance": [{"key": k, "label": lbl, "lo": lo, "hi": hi} for k, lo, hi, lbl in DIST_BANDS],
            "contest": [{"key": k, "label": lbl, "lo": lo, "hi": hi} for k, lo, hi, lbl in CONTEST_BANDS],
        },
        "totalPlays": int(len(_release_frames())),
        "source": "2015-16 SportVU tracked releases, observed outcomes",
    }
