"""Adapter: dashboard court scenario  ->  model feature scenario.

The 3D frontend speaks in court coordinates (feet, hoop at LEFT baseline) and a
small set of shot-type verbs. The trained model speaks in the NBA_Shots schema
(shot_distance, basic_zone, zone_range, action_type, shot_type ...). This module
is the single translation point so the mapping lives in one tested place.

Frontend court frame (see frontend/src/lib/courtDimensions.ts):
  * hoop is at x = -41.75 ft on the left baseline; +x heads up-court.
  * z is the lateral axis, roughly [-25, 25] ft (sideline to sideline).
  * three-point arc radius 23.75 ft, corners break at |z| = 22 ft.
"""
from __future__ import annotations
import math

HOOP_X = -41.75          # left-basket x, feet (courtDimensions.basketX(-1))
HOOP_Y = 5.25            # NBA_Shots loc_y of the rim, feet from baseline
THREE_RADIUS = 23.75     # arc radius, feet
CORNER_Z = 22.0          # corner-3 lateral break, feet

# dashboard shot verb -> NBA_Shots ACTION_TYPE string (must match trained cats;
# OHE handle_unknown='ignore' tolerates a miss, but we match real categories).
ACTION_MAP = {
    "catch_shoot": "Jump Shot",
    "pullup": "Pullup Jump shot",
    "stepback": "Step Back Jump shot",
    "fadeaway": "Turnaround Fadeaway shot",
    "driving_layup": "Driving Layup Shot",
    "layup": "Layup Shot",
    "dunk": "Dunk Shot",
    "floater": "Floating Jump shot",
    "hook": "Hook Shot",
}


def _zone(dist: float, z: float, depth: float) -> tuple[str, str, bool]:
    """Return (basic_zone, zone_range, is_three) from geometry."""
    corner = abs(z) >= CORNER_Z and depth <= 14.0
    is_three = dist >= THREE_RADIUS or (corner and dist >= CORNER_Z)

    if is_three:
        if corner:
            basic = "Left Corner 3" if z < 0 else "Right Corner 3"
        else:
            basic = "Above the Break 3"
    elif dist < 4.0:
        basic = "Restricted Area"
    elif depth <= 19.0 and abs(z) <= 8.0:
        basic = "In The Paint (Non-RA)"
    else:
        basic = "Mid-Range"

    if dist < 8.0:
        zr = "Less Than 8 ft."
    elif dist < 16.0:
        zr = "8-16 ft."
    elif dist < 24.0:
        zr = "16-24 ft."
    else:
        zr = "24+ ft."
    return basic, zr, is_three


def court_to_scenario(court: dict) -> dict:
    """Map a dashboard court scenario to the model scenario dict.

    court keys: x, z (feet); shotType; optional playerId, positionGroup,
    quarter, minsLeft, secsLeft, defenderDistance, shotClock, scoreMargin.
    """
    x = float(court["x"])
    z = float(court["z"])
    depth = x - HOOP_X                      # distance from baseline, feet
    dist = math.hypot(depth, z)             # radial distance from hoop, feet

    basic, zr, is_three = _zone(dist, z, depth)
    shot_verb = str(court.get("shotType", "pullup"))
    action = ACTION_MAP.get(shot_verb, "Pullup Jump shot")

    scenario = {
        "shot_distance": round(dist, 2),
        # NBA_Shots LOC frame: loc_x lateral (feet, ±25), loc_y from the
        # baseline with the rim at HOOP_Y — so a rim shot is loc_y ~= 5-7 ft.
        "loc_x": round(z, 2),
        "loc_y": round(depth + HOOP_Y, 2),
        "basic_zone": basic,
        "zone_range": zr,
        "action_type": action,
        "shot_type": "3PT Field Goal" if is_three else "2PT Field Goal",
        "quarter": int(court.get("quarter", 1)),
        "mins_left": int(court.get("minsLeft", 8)),
        "secs_left": int(court.get("secsLeft", 30)),
        "position_group": str(court.get("positionGroup", "G")),
        "player_id": int(court.get("playerId", 0)),
    }
    for src, dst in (("defenderDistance", "defender_distance"),
                     ("shotClock", "shot_clock"),
                     ("scoreMargin", "score_margin")):
        if court.get(src) is not None:
            scenario[dst] = float(court[src])
    return scenario
