"""Request/response schemas for the analysis endpoints (explore / defend / rank)."""
from __future__ import annotations

from pydantic import BaseModel


class ExploreRequest(BaseModel):
    shotType: str = "catch_shoot"
    playerId: int = 0
    positionGroup: str = "G"
    maxDist: float = 30.0
    step: float = 2.0


class HeatCell(BaseModel):
    x: float
    z: float
    probability: float
    quality: str


class ExploreResponse(BaseModel):
    shot_type: str
    n: int
    cells: list[HeatCell]
    best: HeatCell | None = None


class RankedShot(BaseModel):
    shot_type: str
    probability: float
    quality: str
    expected_points: float
    point_value: int


class RankResponse(BaseModel):
    ranked: list[RankedShot]
    best: RankedShot | None = None


class ContestLevel(BaseModel):
    contest: str
    defender_distance: float
    probability: float
    quality: str


class DefendResponse(BaseModel):
    baseline: dict
    levels: list[ContestLevel]
    contest_swing: float | None = None
    shot_class: str | None = None
    source: str | None = None
