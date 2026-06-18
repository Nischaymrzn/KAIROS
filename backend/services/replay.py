"""Replay service: full ten-player clips from the 2015-16 SportVU logs.

This serves recorded movement, not a prediction. A clip is one shot with every
player and the ball for the seconds leading into the release.

The raw logs are 104 MB of JSON per game inside a 6 MB archive, at 25 Hz, so they
are not read here. `scripts/build_replay_plays.py` converts them offline into
small per-play files already in the court frame the client draws; this module is
a manifest lookup and a file read.

Frame layout, flat so a clip stays small:

    [gameClock, shotClock, ballX, ballZ, ballHeight, p0x, p0z, ... p9x, p9z]

Player order matches `lineup`, which is fixed for the clip.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PLAYS = Path("data/movement/plays")


@lru_cache(maxsize=1)
def _manifest() -> list[dict[str, Any]]:
    f = PLAYS / "manifest.json"
    if not f.exists():
        raise FileNotFoundError(
            "no replay clips built. Run: python scripts/build_replay_plays.py"
        )
    return json.loads(f.read_text())["plays"]


def list_plays(limit: int = 60, made: bool | None = None,
               action: str | None = None) -> dict[str, Any]:
    """Clips available to replay."""
    rows = _manifest()
    if made is not None:
        rows = [r for r in rows if r["made"] == made]
    if action:
        rows = [r for r in rows if action.lower() in r["action"].lower()]
    return {"total": len(rows), "plays": rows[:limit]}


@lru_cache(maxsize=64)
def get_play(game_id: int, event_id: int) -> dict[str, Any]:
    """One clip: lineup, teams, and every frame."""
    f = PLAYS / f"{game_id}-{event_id}.json"
    if not f.exists():
        raise LookupError(f"no clip for game {game_id} event {event_id}")
    return json.loads(f.read_text())
