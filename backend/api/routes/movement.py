"""Movement / trajectory prediction route."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter

from fastapi import HTTPException

from backend.schemas.shot import CourtScenario
from backend.services.movement import predict_path, movement_players
from backend.services import replay as replay_svc
from backend.services import gameplan as plan_svc
from backend.services import coach as coach_svc

router = APIRouter(tags=["movement"])


class MoveRequest(CourtScenario):
    """Court scenario, plus an optional real tracked prefix.

    `observed` rows use the waypoint layout
    (x, y, t, speed, heading, basket_dist, def_dist, has_ball) in the SportVU
    frame. Supply >= `obs` rows to roll the GRU straight from real data; omit it
    and the prefix is seeded from the nearest canonical move template.
    """
    observed: Optional[list[list[float]]] = None


@router.post("/predict/move")
def predict_move(body: MoveRequest) -> dict:
    """Predict the likely off-ball / drive path into this shot."""
    court = body.model_dump(exclude={"observed"})
    return predict_path(court, observed=body.observed)


@router.get("/movement/players")
def movement_player_index() -> dict:
    """Which players can be simulated from their own tracked movement."""
    return movement_players()


# ---------------------------------------------------------------- real replays
#
# Recorded movement, not a prediction. These serve the 2015-16 SportVU corpus:
# the shooter's tracked path over the four seconds into a real release, with what
# the shot actually did. Only plays whose tracking agrees with the shot record are
# offered; see backend/services/replay.py.


@router.get("/replay/plays")
def replay_plays(limit: int = 60, made: bool | None = None,
                 action: str | None = None) -> dict:
    """Real tracked plays available to replay."""
    try:
        return replay_svc.list_plays(limit=limit, made=made, action=action)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))


@router.get("/replay/play/{game_id}/{event_id}")
def replay_play(game_id: int, event_id: int) -> dict:
    """One tracked play, in the court frame the client draws."""
    try:
        return replay_svc.get_play(game_id, event_id)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))


# --------------------------------------------------------------- game plan
#
# The same tracked corpus, aggregated instead of replayed. One possession is
# entertainment; the corpus conditioned on distance and contest is advice.


@router.get("/scenario/plan")
def scenario_plan(distance: float, defender: float | None = None) -> dict:
    """Observed make rates for this kind of shot under this kind of pressure."""
    try:
        return plan_svc.plan(distance, defender)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))


# --------------------------------------------------------------- delivery
#
# The plan says how good the shot is. This says how it should be taken: what the
# feet and the ball were doing on the tracked releases that went in.


@router.get("/scenario/delivery")
def scenario_delivery(distance: float) -> dict:
    """Observed make rates by hold time and by speed at release."""
    try:
        return coach_svc.delivery(distance)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))
