"""Gamification logic — scored by the real shot-quality model.

An attempt is scored by the model's make probability; XP = round(make% × 100)
plus a challenge bonus. Passing the daily challenge extends the streak; missing it
resets the streak. Levels and badges derive from accumulated XP / best streak.
"""
from __future__ import annotations

from sqlmodel import Session, select

from backend.db.models import GameSession, Attempt, DailyChallenge, SavedShot
from backend.services.inference import score_court

LEVEL_XP = 500          # xp per level
CHALLENGE_BONUS = 50    # xp for clearing the daily challenge


def _level(xp: int) -> int:
    return 1 + xp // LEVEL_XP


def _badges(sess: GameSession) -> list[str]:
    b = []
    if sess.best_streak >= 3:
        b.append("hot_hand")
    if sess.best_streak >= 5:
        b.append("on_fire")
    if sess.level >= 5:
        b.append("veteran")
    if sess.attempts >= 25:
        b.append("gym_rat")
    return b


def create_session(db: Session, name: str) -> GameSession:
    sess = GameSession(name=name or "Player")
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


def record_attempt(db: Session, session_id: int, court: dict,
                   challenge_id: int | None = None) -> dict:
    sess = db.get(GameSession, session_id)
    if not sess:
        raise LookupError(f"session {session_id} not found")

    pred = score_court(court)
    p = pred["probability"]

    passed = False
    if challenge_id is not None:
        ch = db.get(DailyChallenge, challenge_id)
        if ch:
            passed = (p >= ch.target_prob
                      and court.get("shotType") == ch.shot_type)

    xp = round(p * 100) + (CHALLENGE_BONUS if passed else 0)
    sess.attempts += 1
    sess.xp += xp
    if passed:
        sess.streak += 1
        sess.best_streak = max(sess.best_streak, sess.streak)
    elif challenge_id is not None:
        sess.streak = 0
    sess.level = _level(sess.xp)

    att = Attempt(session_id=session_id, challenge_id=challenge_id,
                  x=float(court["x"]), z=float(court["z"]),
                  shot_type=str(court.get("shotType", "pullup")),
                  make_prob=p, passed=passed, xp_awarded=xp)
    db.add(sess)
    db.add(att)
    db.commit()
    db.refresh(sess)
    db.refresh(att)
    return {"prediction": pred, "passed": passed, "xp_awarded": xp,
            "attempt_id": att.id, "session": sess, "badges": _badges(sess)}


def leaderboard(db: Session, limit: int = 10) -> list[GameSession]:
    return list(db.exec(
        select(GameSession).order_by(GameSession.xp.desc()).limit(limit)))


def save_shot(db: Session, payload: dict) -> SavedShot:
    pred = score_court(payload)
    shot = SavedShot(
        session_id=payload.get("session_id"),
        label=str(payload.get("label", "")),
        x=float(payload["x"]), z=float(payload["z"]),
        shot_type=str(payload.get("shotType", "pullup")),
        player_id=int(payload.get("playerId", 0)),
        make_prob=pred["probability"])
    db.add(shot)
    db.commit()
    db.refresh(shot)
    return shot


def list_saved(db: Session, session_id: int | None) -> list[SavedShot]:
    q = select(SavedShot).order_by(SavedShot.created_at.desc())
    if session_id is not None:
        q = q.where(SavedShot.session_id == session_id)
    return list(db.exec(q))


def badges_for(sess: GameSession) -> list[str]:
    return _badges(sess)
