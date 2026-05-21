"""SQLModel tables for the gamification / session store.

Kept intentionally small: a session tracks a player's streak/level/xp; attempts
record scored shots; daily challenges are deterministic per date; saved shots are
the user's bookmarked scenarios.
"""
from __future__ import annotations
from datetime import datetime, date
from typing import Optional

from sqlmodel import SQLModel, Field


class GameSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = "Player"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    streak: int = 0
    best_streak: int = 0
    level: int = 1
    xp: int = 0
    attempts: int = 0


class DailyChallenge(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    day: date = Field(index=True, unique=True)
    seed: int
    shot_type: str
    zone: str
    target_prob: float
    description: str


class Attempt(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(index=True, foreign_key="gamesession.id")
    challenge_id: Optional[int] = Field(default=None, foreign_key="dailychallenge.id")
    x: float
    z: float
    shot_type: str
    make_prob: float
    passed: bool = False
    xp_awarded: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SavedShot(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: Optional[int] = Field(default=None, index=True)
    label: str = ""
    x: float
    z: float
    shot_type: str
    player_id: int = 0
    make_prob: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)
