"""Backend API — adapter geometry, prediction/analysis endpoints, and the
gamification loop. Model-backed endpoints skip until the production bundle
exists; pure adapter tests always run. A throwaway SQLite DB isolates the game
store from the real one."""
import os
import tempfile
import uuid

import pytest

# isolate the game DB before any backend module reads settings
_DB = os.path.join(tempfile.gettempdir(), f"hoopiq_test_{uuid.uuid4().hex}.db")
os.environ["HOOPIQ_DB_URL"] = "sqlite:///" + _DB.replace("\\", "/")

from src.config import get_config  # noqa: E402
from backend.services.adapter import court_to_scenario, HOOP_X  # noqa: E402

_MODEL = get_config().path("models") / "calibrated_best.joblib"
_needs_model = pytest.mark.skipif(
    not _MODEL.exists(),
    reason="production model not built yet — run train + calibrate first")

_TRACKING = get_config().path("models") / "production" / "tracking_v1" / "manifest.json"
_needs_tracking = pytest.mark.skipif(
    not _TRACKING.exists(),
    reason="tracking study model not built — run `make tracking-model` first")


# ---- adapter geometry (no model) -----------------------------------------
def test_adapter_restricted_area_layup():
    s = court_to_scenario({"x": HOOP_X + 2, "z": 0, "shotType": "driving_layup"})
    assert s["shot_distance"] == pytest.approx(2.0, abs=0.1)
    assert s["basic_zone"] == "Restricted Area"
    assert s["action_type"] == "Driving Layup Shot"


def test_adapter_above_break_three():
    s = court_to_scenario({"x": HOOP_X + 26, "z": 0, "shotType": "stepback"})
    assert s["shot_type"] == "3PT Field Goal"
    assert s["basic_zone"] == "Above the Break 3"


def test_adapter_corner_three():
    s = court_to_scenario({"x": HOOP_X + 3, "z": -23, "shotType": "catch_shoot"})
    assert s["basic_zone"] == "Left Corner 3"


def test_adapter_loc_y_has_rim_offset():
    s = court_to_scenario({"x": HOOP_X + 2, "z": 0, "shotType": "driving_layup"})
    assert s["loc_y"] == pytest.approx(2 + 5.25, abs=0.01)


# ---- endpoints ------------------------------------------------------------
@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from backend.main import app
    with TestClient(app) as c:   # context-manager runs lifespan (warm + init db)
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_versioned_alias(client):
    assert client.get("/api/v1/health").status_code == 200


def test_error_envelope(client):
    r = client.post("/predict/court", json={"z": 0})  # missing required x
    assert r.status_code == 422
    assert r.json()["error"]["type"] == "validation_error"


@_needs_model
def test_predict_court(client):
    r = client.post("/predict/court",
                    json={"x": HOOP_X + 2, "z": 0, "shotType": "driving_layup"})
    assert r.status_code == 200
    assert 0.0 <= r.json()["probability"] <= 1.0


@_needs_tracking
def test_tracking_endpoint_uses_defender_geometry(client):
    """The 2015-16 study model must respond to real defender geometry: a three
    with a defender in the shot line should score BELOW an open three, and the
    response must label itself a study model with its honest test AUC."""
    contested = client.post("/predict/tracking", json={
        "shot_distance": 25, "is_3": 1, "shot_clock": 4,
        "pre_def_dist": 2.0, "pre_def_angle": 12, "pre_help_defenders": 1})
    openish = client.post("/predict/tracking", json={
        "shot_distance": 25, "is_3": 1, "shot_clock": 14,
        "pre_def_dist": 7.5, "pre_def_angle": 120, "pre_help_defenders": 0})
    assert contested.status_code == 200 and openish.status_code == 200
    cb, ob = contested.json(), openish.json()
    assert 0.0 <= cb["probability"] <= 1.0
    assert cb["probability"] < ob["probability"], "contest must lower the make prob"
    assert cb["model"] == "tracking_v1" and cb["test_auc"] < 0.80


@_needs_model
def test_batch(client):
    pts = [{"x": HOOP_X + d, "z": 0, "shotType": "pullup"} for d in (2, 12, 26)]
    r = client.post("/predict/batch", json={"points": pts})
    assert len(r.json()["predictions"]) == 3


@_needs_model
def test_explore(client):
    r = client.post("/explore", json={"shotType": "catch_shoot", "step": 4})
    body = r.json()
    assert body["n"] > 0 and body["best"] is not None


@_needs_model
def test_defend_three_shows_contest_effect(client):
    r = client.post("/defend", json={"x": HOOP_X + 24, "z": 0, "shotType": "catch_shoot"})
    body = r.json()
    assert body["shot_class"] == "3PT"
    # an open three must score higher than a smothered one
    lv = {x["contest"]: x["probability"] for x in body["levels"]}
    assert lv["open"] > lv["smother"]
    assert body["contest_swing"] > 0


@_needs_model
def test_rank(client):
    r = client.post("/rank", json={"x": HOOP_X + 3, "z": 0, "shotType": "pullup"})
    ranked = r.json()["ranked"]
    assert len(ranked) >= 5
    assert ranked == sorted(ranked, key=lambda x: x["expected_points"], reverse=True)


@_needs_model
def test_move(client):
    r = client.post("/predict/move", json={"x": HOOP_X + 14, "z": 8, "shotType": "pullup"})
    assert len(r.json()["waypoints"]) > 0


@_needs_model
def test_move_actually_runs_the_sequence_model(client):
    """Regression guard: serving must use the TRAINED model, not replay templates.

    Architecture-agnostic on purpose. `best_seq.pt` holds whichever model won the
    last bake-off — the Transformer since the speed-channel repair, the GRU before
    it — and the model card reports that architecture's metrics. What must never
    happen is silently falling back to `template`, which would serve a canned path
    while the card advertises a learned one.
    """
    r = client.post("/predict/move",
                    json={"x": HOOP_X + 14, "z": 8, "shotType": "pullup"}).json()
    method = r["method"]
    assert method != "template", "fell back to a replay template"
    assert method.split("_")[0] in {"gru", "lstm", "transformer"}, method


@_needs_model
def test_move_ends_at_requested_spot(client):
    """The predicted path must terminate exactly on the requested release spot."""
    r = client.post("/predict/move",
                    json={"x": HOOP_X + 14, "z": 8, "shotType": "pullup"}).json()
    last = r["waypoints"][-1]
    assert last["x"] == pytest.approx(8.0, abs=0.05)     # lateral z
    assert last["y"] == pytest.approx(14.0, abs=0.05)    # depth from basket


# ---- gamification loop ----------------------------------------------------
def test_daily_challenge(client):
    r = client.get("/game/challenge/daily")
    assert r.status_code == 200 and "shot_type" in r.json()


@_needs_model
def test_game_loop(client):
    ch = client.get("/game/challenge/daily").json()
    sid = client.post("/game/session", json={"name": "Tester"}).json()["id"]
    att = client.post("/game/attempt", json={
        "sessionId": sid, "challengeId": ch["id"],
        "x": HOOP_X + 2, "z": 0, "shotType": ch["shot_type"]}).json()
    assert att["xp_awarded"] >= 0
    assert att["session"]["attempts"] == 1
    board = client.get("/game/leaderboard").json()
    assert any(s["id"] == sid for s in board)


@_needs_model
def test_save_and_list_shots(client):
    sid = client.post("/game/session", json={"name": "Saver"}).json()["id"]
    client.post("/game/shots", json={
        "sessionId": sid, "label": "corner3", "x": HOOP_X + 3, "z": -23,
        "shotType": "catch_shoot"})
    shots = client.get(f"/game/shots?sessionId={sid}").json()
    assert len(shots) == 1 and shots[0]["label"] == "corner3"
