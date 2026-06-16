"""Player roster routes — real profiles from the frozen model's player lookup."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.services import roster

router = APIRouter(prefix="/players", tags=["players"])


@router.get("")
def list_players() -> dict:
    """Verified named roster (profiles from the production bundle) plus the
    total number of ids the model knows (all queryable via /players/{id})."""
    return {"players": roster.get_roster(), "total_known_ids": roster.roster_size()}


@router.get("/{player_id}")
def get_player(player_id: int) -> dict:
    p = roster.get_player(player_id)
    if p is None:
        raise HTTPException(404, f"player id {player_id} not in the model's lookup")
    return p
