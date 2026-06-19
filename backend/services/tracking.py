"""Tracking-model service — the labelled 2015-16 full-tracking study model.

Wraps `src.serve.tracking.predict`. Distinct from the core `/predict` model: it
consumes REAL defender geometry (distance, angle, help, shot clock) and reports the
measured value of tracking. Clearly labelled as a study model in the response.
"""
from __future__ import annotations

from src.serve.tracking import predict as _predict


def predict_tracking(scenario: dict) -> dict:
    return _predict(scenario)
