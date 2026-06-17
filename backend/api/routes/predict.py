"""Shot-quality prediction routes."""
from __future__ import annotations

from fastapi import APIRouter

from backend.schemas.shot import (ShotScenario, CourtScenario, BatchRequest,
                                  Prediction, BatchResponse)
from backend.services import inference

router = APIRouter(tags=["predict"])


@router.post("/predict", response_model=Prediction)
def predict_native(scenario: ShotScenario) -> dict:
    """Predict from a native NBA_Shots-schema scenario."""
    return inference.score_native(scenario.model_dump())


@router.post("/predict/court", response_model=Prediction)
def predict_court(court: CourtScenario) -> dict:
    """Predict from a dashboard court scenario — the frontend's main call."""
    return inference.score_court(court.model_dump())


@router.post("/predict/batch", response_model=BatchResponse)
def predict_batch(req: BatchRequest) -> dict:
    """Predict many court points at once (Shot Explorer heat grid)."""
    return {"predictions": inference.score_batch([p.model_dump() for p in req.points])}
