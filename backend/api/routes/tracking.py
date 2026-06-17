"""Tracking study-model route — shot quality from REAL defender geometry (2015-16).

A clearly-labelled study endpoint: unlike `/predict` (the production core model,
contest-blind), this scores a shot using real per-shot tracking and reports the
measured value of that tracking. See reports/TRACKING_MODEL.md.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.services.tracking import predict_tracking

router = APIRouter(tags=["tracking"])


class TrackingScenario(BaseModel):
    """A shot with real pre-release tracking inputs. Anything omitted falls back to
    the model's train-fit median."""
    shot_distance: float = Field(..., ge=0, le=94)
    is_3: int = Field(0, ge=0, le=1)
    player_id: Optional[int] = None
    period: Optional[int] = Field(None, ge=1, le=10)
    shot_clock: Optional[float] = Field(None, ge=0, le=24)
    release_height: Optional[float] = Field(None, ge=0, le=20)
    time_with_ball: Optional[float] = Field(None, ge=0)
    shooter_speed: Optional[float] = Field(None, ge=0, le=40)
    pre_def_dist: Optional[float] = Field(None, ge=0, description="closest defender (ft)")
    pre_def_dist_2: Optional[float] = Field(None, ge=0)
    pre_def_angle: Optional[float] = Field(None, ge=0, le=180,
                                           description="0 = defender in the shot line")
    pre_help_defenders: Optional[int] = Field(None, ge=0, le=5)
    pre_closing_speed: Optional[float] = Field(None, ge=-40, le=40)


@router.post("/predict/tracking")
def predict_tracking_route(body: TrackingScenario) -> dict:
    """Shot quality from real defender geometry (2015-16 study model)."""
    return predict_tracking(body.model_dump(exclude_none=True))
