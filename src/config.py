"""Loads config.yaml into a typed, attribute-accessible object.

Usage:
    from src.config import get_config
    cfg = get_config()
    cfg.seed                      # 42
    cfg.data.tier                 # "A"
    cfg.path("models")            # absolute Path, created if missing
    cfg.raw_path("nba_shots_dir") # absolute Path to a source

All paths in config.yaml are resolved relative to the repo root (the parent of
this file's package).
"""
from __future__ import annotations
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
_CONFIG_FILE = ROOT / "config.yaml"


def _to_ns(obj: Any) -> Any:
    if isinstance(obj, dict):
        return SimpleNamespace(**{k: _to_ns(v) for k, v in obj.items()})
    if isinstance(obj, list):
        return [_to_ns(v) for v in obj]
    return obj


class Config(SimpleNamespace):
    """Config tree with helpers to resolve and create paths."""

    _raw: dict

    def path(self, key: str, create: bool = True) -> Path:
        """Resolve a working directory under paths.* (e.g. 'models')."""
        p = (ROOT / getattr(self.paths, key)).resolve()
        if create:
            p.mkdir(parents=True, exist_ok=True)
        return p

    def raw_path(self, key: str) -> Path:
        """Resolve a source path under paths.* without creating it."""
        return (ROOT / getattr(self.paths, key)).resolve()

    def as_dict(self) -> dict:
        return self._raw


_cache: Config | None = None


def get_config(reload: bool = False) -> Config:
    global _cache
    if _cache is not None and not reload:
        return _cache
    raw = yaml.safe_load(_CONFIG_FILE.read_text())
    ns = _to_ns(raw)
    cfg = Config(**ns.__dict__)
    cfg._raw = raw
    _cache = cfg
    return cfg
