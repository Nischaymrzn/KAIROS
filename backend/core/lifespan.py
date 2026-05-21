"""Startup / shutdown: warm the models once and create the game DB tables.

Loading the CatBoost/LightGBM bundle, calibrator, tables and (optionally) the
SHAP explainer at startup removes the multi-second first-request penalty.
"""
from __future__ import annotations
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.core.config import get_settings

log = logging.getLogger("hoopiq.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info("starting %s v%s", settings.app_name, settings.version)

    # 1) warm the shot-quality + movement models (src.serve caches state)
    try:
        from src.serve.predict import _load as load_shot
        load_shot()
        if settings.warm_explainer:
            # touch a prediction so the SHAP explainer initialises now
            from src.serve.predict import predict
            predict({"shot_distance": 14, "basic_zone": "Mid-Range"})
        from src.serve.movement import _load as load_move
        load_move()
        log.info("models warmed")
    except Exception:  # noqa: BLE001
        log.exception("model warm-up failed (endpoints will lazy-load)")

    # 2) create the gamification tables + seed today's challenge
    try:
        from backend.db.session import init_db
        init_db()
        log.info("game store ready")
    except Exception:  # noqa: BLE001
        log.exception("game store init failed")

    yield
    log.info("shutting down")
