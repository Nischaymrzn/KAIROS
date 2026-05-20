"""Application settings (environment-driven, 12-factor).

Every value can be overridden with a `HOOPIQ_`-prefixed env var, e.g.
`HOOPIQ_CORS_ORIGINS='["http://localhost:5173"]'` or `HOOPIQ_LOG_LEVEL=DEBUG`.
"""
from __future__ import annotations
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="HOOPIQ_", env_file=".env", extra="ignore")

    app_name: str = "HoopIQ Inference API"
    version: str = "2.0.0"
    description: str = ("Shot-quality + movement + game-analysis API over the "
                        "frozen HoopIQ production models.")
    api_prefix: str = "/api/v1"

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"

    # the Vite dev server + preview proxy call this cross-origin
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    # gamification / session store (SQLite by default; swap via env for Postgres)
    db_url: str = "sqlite:///./data/hoopiq_game.db"

    # warm the SHAP explainer at startup (adds ~1 s but removes first-call latency)
    warm_explainer: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
