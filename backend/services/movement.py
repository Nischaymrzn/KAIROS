"""Movement service — predicted approach path into a shot.

The movement model's loc_y is basket-relative (0 at the rim); the shot model's
loc_y is baseline-relative (rim at HOOP_Y). We shift it back before serving so
the returned release waypoint lands exactly on the requested court spot.
"""
from __future__ import annotations

from src.serve.movement import predict_move, predict_move_player, player_move_index
from backend.services.adapter import court_to_scenario, HOOP_Y


def predict_path(court: dict, observed: list | None = None) -> dict:
    """Predicted approach path.

    With a `playerId` that has a tracked signature, this returns that player's
    OWN real approach to the spot under the requested contest — retrieved from
    the 2015-16 corpus, not generated. Otherwise it falls back to the league
    model: when `observed` (a real tracked prefix) is given the GRU rolls out
    directly from it, else the prefix is seeded from the nearest canonical
    template and the GRU predicts the continuation.
    """
    scen = court_to_scenario(court)
    scen["loc_y"] = scen["loc_y"] - HOOP_Y

    pid = court.get("playerId") or 0
    if pid and observed is None:
        hit = predict_move_player(scen, int(pid), court.get("defenderDistance"))
        if hit is not None:
            return hit
    out = predict_move(scen, observed=observed)
    out["player_id"] = int(pid) or None
    # say so plainly rather than letting a league path pass as this player's
    out["fallback_reason"] = (
        None if not pid else "no tracked movement signature for this player"
    )
    return out


def movement_players() -> dict:
    """Players with a tracked movement signature, strongest first."""
    return player_move_index()
