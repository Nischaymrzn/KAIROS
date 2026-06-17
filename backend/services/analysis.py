"""Analysis service — the dashboard's headline capabilities on the real model.

* explore_grid  — make-% over a half-court grid (Shot Explorer heat map)
* rank_shot_types — best shot type at a spot, ranked by make% and expected points
* defend — how a shot's make-% falls as the defender closes (contest sweep)
"""
from __future__ import annotations
import json
import math

from src.config import get_config
from src.serve.predict import predict, _quality
from backend.services.adapter import court_to_scenario, HOOP_X, ACTION_MAP
from backend.services.inference import score_batch, score_court

# contest levels for the Defensive view (closest-defender distance, feet)
CONTEST_LEVELS = [("smother", 1.0), ("heavy", 2.0), ("contested", 3.5),
                  ("light", 5.5), ("open", 8.0)]

_CONTEST_CURVE = None


def _contest_curve() -> dict:
    """Empirical make-rate multipliers per contest tier (from the 2014-15
    defender study). The 2018-23 core model is contest-blind (defender distance
    imputed), so the Defensive view applies these real multipliers instead."""
    global _CONTEST_CURVE
    if _CONTEST_CURVE is None:
        fp = get_config().path("models") / "studies" / "contest_curve.json"
        _CONTEST_CURVE = json.loads(fp.read_text()) if fp.exists() else {}
    return _CONTEST_CURVE


def _grid_points(max_dist: float, step: float) -> list[tuple[float, float]]:
    pts = []
    x = -46.0
    while x <= -3.0:
        z = -23.0
        while z <= 23.0:
            if math.hypot(x - HOOP_X, z) <= max_dist:
                pts.append((round(x, 2), round(z, 2)))
            z += step
        x += step
    return pts


def explore_grid(shot_type: str, player_id: int = 0, position_group: str = "G",
                 max_dist: float = 30.0, step: float = 2.0) -> dict:
    """Make-% for every sampled court point, for one shot type."""
    pts = _grid_points(max_dist, step)
    courts = [{"x": x, "z": z, "shotType": shot_type,
               "playerId": player_id, "positionGroup": position_group}
              for x, z in pts]
    preds = score_batch(courts)
    cells = [{"x": x, "z": z, "probability": p["probability"], "quality": p["quality"]}
             for (x, z), p in zip(pts, preds)]
    best = max(cells, key=lambda c: c["probability"]) if cells else None
    return {"shot_type": shot_type, "n": len(cells), "cells": cells, "best": best}


def rank_shot_types(court: dict) -> dict:
    """At one spot, rank every shot type by make-% and expected points.

    Batched on purpose. This used to call `predict()` once per action inside a
    loop, and a single prediction costs about two seconds of feature assembly and
    model load, so ranking nine actions took eighteen to twenty seconds. The
    client gives a request far less than that, so the panel that ranks shot
    options timed out every time rather than returning slowly — a feature that
    looked broken because of a loop.

    `score_batch` builds the frame once and scores every row together, which is
    what the explorer grid already did for hundreds of points.
    """
    verbs = list(ACTION_MAP)
    scens = [court_to_scenario({**court, "shotType": v}) for v in verbs]
    preds = score_batch([{**court, "shotType": v} for v in verbs])

    rows = []
    for verb, scen, r in zip(verbs, scens, preds):
        pts = 3 if scen["shot_type"] == "3PT Field Goal" else 2
        rows.append({"shot_type": verb, "probability": r["probability"],
                     "quality": r["quality"],
                     "expected_points": round(r["probability"] * pts, 3),
                     "point_value": pts})
    rows.sort(key=lambda r: r["expected_points"], reverse=True)
    return {"ranked": rows, "best": rows[0] if rows else None}


def defend(court: dict) -> dict:
    """How a shot's make-% changes as the defender closes.

    The core 2018-23 model cannot see defender distance (imputed in training), so
    we take its contest-neutral probability and scale it by the **empirical
    make-rate multipliers measured in the 2014-15 tracking study** (per shot
    class). This makes the Defensive view real and honest rather than flat.
    """
    base = score_court({**court, "defenderDistance": None})
    p0 = base["probability"]
    scen = court_to_scenario(court)
    shot_class = "3PT" if scen["shot_type"] == "3PT Field Goal" else "2PT"
    curve = _contest_curve().get(shot_class, {})
    bands = get_config().quality_bands

    rows = []
    for name, dist in CONTEST_LEVELS:
        mult = float(curve.get(name, 1.0))
        p = round(min(0.99, max(0.01, p0 * mult)), 4)
        rows.append({"contest": name, "defender_distance": dist,
                     "probability": p, "quality": _quality(p, bands)})
    open_p = next((r["probability"] for r in rows if r["contest"] == "open"), None)
    smother_p = next((r["probability"] for r in rows if r["contest"] == "smother"), None)
    swing = round((open_p - smother_p), 4) if (open_p and smother_p) else None
    return {"baseline": base, "levels": rows, "contest_swing": swing,
            "shot_class": shot_class, "source": "2014-15 tracking study"}
