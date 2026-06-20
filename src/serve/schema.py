"""Request/response schema for the inference service (used later by FastAPI)."""
from __future__ import annotations
from typing import Optional

try:
    from pydantic import BaseModel, Field
except ImportError:  # pydantic optional until the API is built
    BaseModel = object  # type: ignore

    def Field(default=None, **_):  # type: ignore
        return default


class ShotScenario(BaseModel):
    loc_x: float = Field(0.0, description="court x (feet, hoop near origin)")
    loc_y: float = Field(12.0, description="court y (feet toward basket)")
    shot_distance: float = Field(14.0)
    action_type: str = Field("Pullup Jump shot")
    shot_type: str = Field("2PT Field Goal")        # or "3PT Field Goal"
    basic_zone: str = Field("Mid-Range")
    zone_range: str = Field("16-24 ft.")
    quarter: int = Field(1)
    mins_left: int = Field(8)
    secs_left: int = Field(30)
    position_group: str = Field("G")
    player_id: int = Field(0)
    # optional context that overrides the imputed defaults
    defender_distance: Optional[float] = Field(None)
    shot_clock: Optional[float] = Field(None)
    score_margin: Optional[float] = Field(None)


class Factor(BaseModel):
    feature: str
    contribution: float


class Prediction(BaseModel):
    probability: float
    quality: str
    factors: list  # list[Factor]
