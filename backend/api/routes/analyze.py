"""Analytical capabilities: Shot Explorer, shot-type ranking, Defensive view."""
from __future__ import annotations

from fastapi import APIRouter

from backend.schemas.shot import CourtScenario
from backend.schemas.analyze import (ExploreRequest, ExploreResponse,
                                     RankResponse, DefendResponse)
from backend.services import analysis

router = APIRouter(tags=["analyze"])


@router.post("/explore", response_model=ExploreResponse)
def explore(req: ExploreRequest) -> dict:
    """Make-% over a half-court grid for one shot type (heat map)."""
    return analysis.explore_grid(req.shotType, req.playerId, req.positionGroup,
                                 req.maxDist, req.step)


@router.post("/rank", response_model=RankResponse)
def rank(court: CourtScenario) -> dict:
    """Rank every shot type at a spot by make-% and expected points."""
    return analysis.rank_shot_types(court.model_dump())


@router.post("/defend", response_model=DefendResponse)
def defend(court: CourtScenario) -> dict:
    """Re-score a shot across contest levels — what closing out is worth."""
    return analysis.defend(court.model_dump())
