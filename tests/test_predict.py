"""The serve function must return a probability, a label, and ranked factors."""
import pytest

from src.config import get_config

_MODEL = get_config().path("models") / "calibrated_best.joblib"
pytestmark = pytest.mark.skipif(
    not _MODEL.exists(),
    reason="production model not built yet — run train + calibrate first")


def test_predict_shape():
    from src.serve.predict import predict
    r = predict({
        "action_type": "Driving Layup Shot", "shot_type": "2PT Field Goal",
        "basic_zone": "Restricted Area", "zone_range": "Less Than 8 ft.",
        "shot_distance": 2, "loc_x": 0, "loc_y": 8, "defender_distance": 5,
    })
    assert 0.0 <= r["probability"] <= 1.0
    assert r["quality"] in {"Excellent", "Good", "Average", "Poor", "Very Poor"}
    assert isinstance(r["factors"], list)


def test_zone_signal():
    """A restricted-area layup should score clearly higher than a contested
    long three (the model's strongest, real Tier-A signal: zone + distance)."""
    from src.serve.predict import predict
    layup = predict({
        "action_type": "Driving Layup Shot", "shot_type": "2PT Field Goal",
        "basic_zone": "Restricted Area", "zone_range": "Less Than 8 ft.",
        "shot_distance": 2, "loc_x": 0, "loc_y": 8})["probability"]
    deep_three = predict({
        "action_type": "Step Back Jump shot", "shot_type": "3PT Field Goal",
        "basic_zone": "Above the Break 3", "zone_range": "24+ ft.",
        "shot_distance": 26, "loc_x": 60, "loc_y": 240})["probability"]
    assert layup > deep_three
