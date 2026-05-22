"""Database engine + session dependency + one-time init/seed.

SQLite by default (file under data/); swap `HOOPIQ_DB_URL` for Postgres in prod.
"""
from __future__ import annotations
from datetime import date
from pathlib import Path

from sqlmodel import SQLModel, Session, create_engine, select

from backend.core.config import get_settings
from backend.db.models import DailyChallenge
from backend.db.seed import challenge_for

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        url = get_settings().db_url
        if url.startswith("sqlite:///./"):
            Path(url.replace("sqlite:///./", "", 1)).parent.mkdir(
                parents=True, exist_ok=True)
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, echo=False, connect_args=connect_args)
    return _engine


def init_db() -> None:
    """Create tables and ensure today's challenge exists."""
    engine = get_engine()
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        ensure_daily(s, date.today())


def ensure_daily(session: Session, day: date) -> DailyChallenge:
    """Return the day's challenge, creating it if absent."""
    existing = session.exec(
        select(DailyChallenge).where(DailyChallenge.day == day)).first()
    if existing:
        return existing
    ch = challenge_for(day)
    session.add(ch)
    session.commit()
    session.refresh(ch)
    return ch


def get_session():
    """FastAPI dependency: yields a session per request."""
    with Session(get_engine()) as session:
        yield session
