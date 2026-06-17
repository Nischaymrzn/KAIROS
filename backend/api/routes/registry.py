"""Model registry route — every frozen production bundle, from its own manifest.

Nothing here is hand-written: the response is read from the manifest/metrics
files that training froze into `models/production/`, so the registry always
reflects exactly what is deployed.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

from src.config import get_config

router = APIRouter(tags=["registry"])

# stable metadata about where each bundle is used (the serving wiring is code,
# so this mapping lives in code — the metrics themselves come from disk)
BUNDLE_ROLES = {
    "core": {"serves": ["/predict/court", "/predict/batch", "/explore", "/rank",
                        "/defend", "/game/attempt"],
             "label": "Shot quality (production)"},
    "era_v1": {"serves": [], "label": "Era-drift study (2014-2026 window)"},
    "tracking_v1": {"serves": ["/predict/tracking"],
                    "label": "Tracking study (2015-16 real defender geometry)"},
    "player_season_v1": {"serves": [],
                         "label": "Player-season efficiency (preseason forecast)"},
    "movement": {"serves": ["/predict/move"], "label": "Movement / approach paths"},
}


def _read_json(p: Path) -> dict | None:
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return None


@router.get("/models")
def list_models() -> dict:
    prod = get_config().path("models") / "production"
    latest = (_read_json(prod / "latest.json") or {}).get("version")

    bundles: list[dict] = []

    # core shot-quality versions (v1..vN)
    for d in sorted(prod.glob("v*")):
        m = _read_json(d / "manifest.json")
        if not m:
            continue
        ver = m.get("version", d.name.lstrip("v"))
        bundles.append({
            "key": d.name, "family": "core", "active": ver == latest,
            **BUNDLE_ROLES["core"], "manifest": m,
        })

    # specialty bundles
    for key in ("era_v1", "tracking_v1", "player_season_v1"):
        m = _read_json(prod / key / "manifest.json")
        if m:
            bundles.append({"key": key, "family": key, "active": True,
                            **BUNDLE_ROLES[key], "manifest": m})

    # movement bundle ships inside the active core version
    mv = _read_json(prod / f"v{latest}" / "movement" / "metrics.json")
    if mv:
        bundles.append({"key": f"v{latest}/movement", "family": "movement",
                        "active": True, **BUNDLE_ROLES["movement"],
                        "manifest": mv})

    return {"latest_core_version": latest, "bundles": bundles}
