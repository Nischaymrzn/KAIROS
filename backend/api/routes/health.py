"""Liveness + model metadata."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.api.deps import get_manifest

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    m = get_manifest()
    return {
        "status": "ok",
        "model_version": m.get("version", "unknown"),
        "model": m.get("model"),
        "shot_auc": (m.get("test_metrics") or {}).get("auc"),
    }


@router.get("/model-info")
def model_info() -> dict:
    m = get_manifest()
    if not m:
        raise HTTPException(404, "No production manifest found.")

    # Whether the served model actually responds to defender distance, measured by
    # running it rather than read from a flag. The frontend used to hardcode "the
    # core model is contest-blind", which was true under v7 and false under v8, so
    # the UI told users the defender control did nothing while it was working.
    # Reporting it here means the claim tracks the artefact instead of the prose.
    from src.serve.predict import core_model_is_contest_sensitive
    return {**m, "contest_sensitive": bool(core_model_is_contest_sensitive())}
