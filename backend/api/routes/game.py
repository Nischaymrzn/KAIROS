"""Gamification routes: daily challenge, sessions, scored attempts, leaderboard,
saved shots — all scored by the real shot-quality model."""
from __future__ import annotations
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from backend.api.deps import get_session
from backend.db.session import ensure_daily
from backend.db.models import GameSession
from backend.schemas.game import (SessionCreate, SessionRead, ChallengeRead,
                                  AttemptRequest, AttemptResponse,
                                  SaveShotRequest, SavedShotRead)
from backend.services import game as game_svc

router = APIRouter(prefix="/game", tags=["game"])


@router.get("/challenge/daily", response_model=ChallengeRead)
def daily_challenge(db: Session = Depends(get_session)):
    return ensure_daily(db, date.today())


@router.post("/session", response_model=SessionRead)
def create_session(body: SessionCreate, db: Session = Depends(get_session)):
    return game_svc.create_session(db, body.name)


@router.get("/session/{session_id}", response_model=SessionRead)
def get_session_row(session_id: int, db: Session = Depends(get_session)):
    s = db.get(GameSession, session_id)
    if not s:
        raise HTTPException(404, "session not found")
    return s


@router.post("/attempt", response_model=AttemptResponse)
def attempt(body: AttemptRequest, db: Session = Depends(get_session)):
    try:
        return game_svc.record_attempt(db, body.sessionId, body.model_dump(),
                                       body.challengeId)
    except LookupError as e:
        raise HTTPException(404, str(e))


@router.get("/leaderboard", response_model=list[SessionRead])
def leaderboard(limit: int = 10, db: Session = Depends(get_session)):
    return game_svc.leaderboard(db, limit)


@router.post("/shots", response_model=SavedShotRead)
def save_shot(body: SaveShotRequest, db: Session = Depends(get_session)):
    payload = body.model_dump()
    payload["session_id"] = body.sessionId
    return game_svc.save_shot(db, payload)


@router.get("/shots", response_model=list[SavedShotRead])
def list_shots(sessionId: int | None = None, db: Session = Depends(get_session)):
    return game_svc.list_saved(db, sessionId)
