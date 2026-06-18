"""Inference service — the app-facing wrapper over `src.serve.predict`.

`src.serve.predict` already caches the loaded model as a process singleton, so
this layer just adapts court scenarios and exposes clean functions the routes
call (keeping FastAPI code free of model details)."""
from __future__ import annotations

from src.serve.predict import predict, predict_batch
from backend.services.adapter import court_to_scenario


def score_native(scenario: dict) -> dict:
    """Predict from a native NBA_Shots-schema scenario."""
    return predict(scenario)


def score_court(court: dict) -> dict:
    """Predict from a dashboard court scenario (the frontend's main call)."""
    return predict(court_to_scenario(court))


def score_batch(courts: list[dict]) -> list[dict]:
    """Vectorised prediction over many court points (Explorer grid)."""
    return predict_batch([court_to_scenario(c) for c in courts])
