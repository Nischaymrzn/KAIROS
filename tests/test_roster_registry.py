"""Roster + model-registry endpoints — the routes the Player Lab, shooter chip
and Models page depend on. Everything asserts against the FROZEN bundles (the
lookup and the manifests), so these tests also guard the bundle contract."""
import os
import tempfile
import uuid

import pytest

# isolate the game DB before any backend module reads settings
_DB = os.path.join(tempfile.gettempdir(), f"hoopiq_test_{uuid.uuid4().hex}.db")
os.environ.setdefault("HOOPIQ_DB_URL", "sqlite:///" + _DB.replace("\\", "/"))

from src.config import get_config  # noqa: E402

_MODEL = get_config().path("models") / "calibrated_best.joblib"
_needs_model = pytest.mark.skipif(
    not _MODEL.exists(),
    reason="production model not built yet — run train + calibrate first")


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from backend.main import app
    with TestClient(app) as c:
        yield c


# ---- /players -----------------------------------------------------------------
@_needs_model
def test_roster_shape_and_size(client):
    r = client.get("/players")
    assert r.status_code == 200
    body = r.json()
    assert body["total_known_ids"] > 900  # the frozen lookup carries ~1017 ids
    players = body["players"]
    assert len(players) >= 50
    sample = players[0]
    for key in ("id", "name", "position", "profile", "imputed", "bio_source"):
        assert key in sample


@_needs_model
def test_roster_bio_sources_are_honest(client):
    """Names with imputed bios must be FLAGGED, never presented as measured."""
    players = client.get("/players").json()["players"]
    by_name = {p["name"]: p for p in players}
    # Curry's combine data is real in the lookup
    assert by_name["Stephen Curry"]["bio_source"] == "measured"
    assert by_name["Stephen Curry"]["profile"]["height_in"] == pytest.approx(74, abs=1)
    # LeBron's bio fields are league-median placeholders — must be flagged
    assert by_name["LeBron James"]["bio_source"] == "league_imputed"


@_needs_model
def test_player_by_id_and_unknown(client):
    ok = client.get("/players/201939")  # Curry
    assert ok.status_code == 200
    assert ok.json()["name"] == "Stephen Curry"
    missing = client.get("/players/1")  # not an id the lookup knows
    assert missing.status_code == 404


# ---- /models -------------------------------------------------------------------
@_needs_model
def test_registry_lists_all_bundle_families(client):
    r = client.get("/models")
    assert r.status_code == 200
    body = r.json()
    families = {b["family"] for b in body["bundles"]}
    assert {"core", "era_v1", "tracking_v1", "player_season_v1"} <= families
    # exactly one ACTIVE core bundle, and it matches latest.json
    active_core = [b for b in body["bundles"] if b["family"] == "core" and b["active"]]
    assert len(active_core) == 1
    assert active_core[0]["manifest"]["version"] == body["latest_core_version"]


@_needs_model
def test_registry_metrics_come_from_manifests(client):
    body = client.get("/models").json()
    era = next(b for b in body["bundles"] if b["family"] == "era_v1")
    # the era study's headline finding is in its own manifest
    assert "comparison" in era["manifest"]
    ps = next(b for b in body["bundles"] if b["family"] == "player_season_v1")
    assert ps["manifest"]["test_metrics"]["auc"] > 0.75  # the legit 0.81 study
