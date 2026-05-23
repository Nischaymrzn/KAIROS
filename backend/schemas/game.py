"""Request/response schemas for the gamification endpoints."""
from __future__ import annotations
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from backend.schemas.shot import CourtScenario


class SessionCreate(BaseModel):
    name: str = "Player"


class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    streak: int
    best_streak: int
    level: int
    xp: int
    attempts: int
    created_at: datetime


class ChallengeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    day: date
    shot_type: str
    zone: str
    target_prob: float
    description: str


class AttemptRequest(CourtScenario):
    sessionId: int
    challengeId: Optional[int] = None


class AttemptResponse(BaseModel):
    prediction: dict
    passed: bool
    xp_awarded: int
    attempt_id: int
    session: SessionRead
    badges: list[str]


class SaveShotRequest(CourtScenario):
    label: str = ""
    sessionId: Optional[int] = None


class SavedShotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: str
    x: float
    z: float
    shot_type: str
    player_id: int
    make_prob: float
    created_at: datetime
