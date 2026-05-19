"""Shared FastAPI dependencies."""
from __future__ import annotations
import json
from functools import lru_cache

from src.config import get_config
# re-exported so routes can `from backend.api.deps import get_session`
from backend.db.session import get_session

__all__ = ["get_session", "get_manifest"]


@lru_cache(maxsize=1)
def get_manifest() -> dict:
    """Production manifest (version + metrics) from models/production/latest."""
    cfg = get_config()
    latest = cfg.path("models") / "production" / "latest.json"
    if not latest.exists():
        return {}
    ptr = json.loads(latest.read_text())
    ver = ptr.get("version", "")
    ver_dir = latest.parent / (f"v{ver}" if isinstance(ver, int) else str(ver))
    man = ver_dir / "manifest.json"
    return json.loads(man.read_text()) if man.exists() else ptr
