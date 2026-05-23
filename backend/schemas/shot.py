"""Request/response schemas for the prediction endpoints."""
from __future__ import annotations
from typing import Optional

from pydantic import BaseModel, Field

# the native NBA_Shots-schema scenario + Prediction live in src.serve.schema
# (re-exported here so routes/tests import them from backend.schemas.shot)
from src.serve.schema import ShotScenario, Prediction

__all__ = ["ShotScenario", "Prediction", "CourtScenario", "BatchRequest",
           "BatchPrediction", "BatchResponse"]


class CourtScenario(BaseModel):
    """Dashboard court scenario — feet, hoop at the left baseline."""
    x: float = Field(..., description="court x (feet); hoop at -41.75")
    z: float = Field(..., description="lateral court position (feet)")
    shotType: str = "pullup"
    playerId: int = 0
    positionGroup: str = "G"
    quarter: int = 1
    minsLeft: int = 8
    secsLeft: int = 30
    defenderDistance: Optional[float] = None
    shotClock: Optional[float] = None
    scoreMargin: Optional[float] = None


class BatchRequest(BaseModel):
    points: list[CourtScenario]


class BatchPrediction(BaseModel):
    probability: float
    quality: str


class BatchResponse(BaseModel):
    predictions: list[BatchPrediction]
