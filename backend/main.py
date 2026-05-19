"""HoopIQ inference API — application factory.

Wraps the frozen production models (shot-quality + movement) and the gamification
store in a structured FastAPI app: config-driven settings, structured logging with
request ids, model warm-up at startup, consistent error envelopes, and CORS.

Every route is mounted twice — at the root (the paused frontend calls
`/predict/court`, `/predict/batch`, `/predict/move`) and under the versioned
`/api/v1` prefix.

Run:  uvicorn backend.main:app --reload --port 8000   (or `make api`)
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import get_settings
from backend.core.logging import configure_logging, RequestContextMiddleware
from backend.core.errors import register_error_handlers
from backend.core.lifespan import lifespan
from backend.api.routes import (health, predict, analyze, movement, game,
                                tracking, players, registry)

_ROUTERS = [health.router, predict.router, analyze.router,
            movement.router, game.router, tracking.router,
            players.router, registry.router]


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        description=settings.description,
        lifespan=lifespan,
        openapi_tags=[
            {"name": "health", "description": "Liveness + model metadata"},
            {"name": "predict", "description": "Shot-quality prediction"},
            {"name": "analyze", "description": "Explorer, shot-type ranking, defence"},
            {"name": "movement", "description": "Trajectory / approach paths"},
            {"name": "tracking", "description": "2015-16 study model — real defender geometry"},
            {"name": "game", "description": "Challenges, sessions, scoring, leaderboard"},
            {"name": "players", "description": "Real player profiles from the model lookup"},
            {"name": "registry", "description": "Frozen production bundle manifests"},
        ],
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)

    for router in _ROUTERS:
        app.include_router(router)                            # root (frontend)
        app.include_router(router, prefix=settings.api_prefix)  # /api/v1 alias

    @app.get("/", tags=["health"], include_in_schema=False)
    def root() -> dict:
        return {"service": settings.app_name, "version": settings.version,
                "docs": "/docs"}

    return app


app = create_app()
