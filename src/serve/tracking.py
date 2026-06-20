"""Serve the frozen 2015-16 full-tracking shot-quality model (Model 2).

This is a **labelled study model** (`models/production/tracking_v1/`), separate from
the production core model. It answers "given REAL defender geometry and the true
shot clock, how good is this shot?" — the signal the core model can only impute.
Given a scenario with tracking inputs, it returns a calibrated make probability, a
quality label, and the honest context (its held-out AUC and the measured gain real
tracking buys over a no-tracking model).

The exported winner is the boosting model on hand-engineered aggregates (it beat the
Set-Transformer on 2015-16, see reports/TRACKING_MODEL.md), so serving builds the
flat feature row; missing inputs fall back to the train-fit medians in the bundle.

CLI smoke test:  python -m src.serve.tracking
"""
from __future__ import annotations
import json

import joblib
import numpy as np
import pandas as pd

from src.config import get_config

_STATE = None


def _load():
    global _STATE
    if _STATE is not None:
        return _STATE
    cfg = get_config()
    d = cfg.path("models") / "production" / "tracking_v1"
    manifest = json.loads((d / "manifest.json").read_text())
    if manifest["kind"] != "lgb":
        raise RuntimeError(f"serving supports the boosting winner; got {manifest['kind']}")
    bundle = joblib.load(d / "model.joblib")          # {model, cols, median, kind}
    cal = joblib.load(d / "calibrator.joblib")        # isotonic
    skill = joblib.load(d / "player_fg.joblib")       # {table, default}
    _STATE = dict(cfg=cfg, manifest=manifest, bundle=bundle, cal=cal, skill=skill)
    return _STATE


def _quality(p: float, bands) -> str:
    if p >= bands.excellent: return "Excellent"
    if p >= bands.good: return "Good"
    if p >= bands.average: return "Average"
    if p >= bands.poor: return "Poor"
    return "Very Poor"


def _feature_row(scenario: dict, st) -> pd.DataFrame:
    """Build the model's flat feature row from a tracking scenario; anything not
    supplied falls back to the bundle's train-fit median."""
    bundle = st["bundle"]
    is_3 = int(scenario.get("is_3", 1 if scenario.get("shot_type") == "3PT Field Goal" else 0))
    pid = int(scenario.get("player_id", 0))
    player_fg = float(st["skill"]["table"].get(pid, st["skill"]["default"]))
    def_dist = float(scenario.get("pre_def_dist", scenario.get("defender_distance", np.nan)))
    raw = {
        "SHOT_DISTANCE": scenario.get("shot_distance", np.nan),
        "is_3": is_3,
        "period": scenario.get("period", scenario.get("quarter", np.nan)),
        "pre_shot_clock": scenario.get("shot_clock", np.nan),
        "pre_release_height": scenario.get("release_height", np.nan),
        "pre_time_with_ball": scenario.get("time_with_ball", np.nan),
        "pre_shooter_speed": scenario.get("shooter_speed", np.nan),
        "player_fg": player_fg,
        "pre_def_dist": def_dist,
        "pre_def_dist_2": scenario.get("pre_def_dist_2", np.nan),
        "pre_def_angle": scenario.get("pre_def_angle", scenario.get("defender_angle", np.nan)),
        "pre_help_defenders": scenario.get("pre_help_defenders", np.nan),
        "pre_closing_speed": scenario.get("pre_closing_speed", np.nan),
        "pre_def_x_3": (def_dist * is_3) if def_dist == def_dist else np.nan,
    }
    row = pd.DataFrame([{c: raw.get(c, np.nan) for c in bundle["cols"]}])
    return row[bundle["cols"]].apply(pd.to_numeric, errors="coerce").fillna(bundle["median"])


def predict(scenario: dict) -> dict:
    """Calibrated make probability for a shot with REAL tracking inputs."""
    st = _load()
    row = _feature_row(scenario, st)
    p_raw = st["bundle"]["model"].predict_proba(row)[:, 1]
    p = float(st["cal"].transform(p_raw)[0])
    m = st["manifest"]
    return {
        "probability": round(p, 4),
        "quality": _quality(p, st["cfg"].quality_bands),
        "model": "tracking_v1",
        "model_note": "2015-16 SportVU study model (real defender geometry); "
                      "not the production core model",
        "test_auc": round(m["test_metrics"]["auc"], 4),
        "tracking_gain_auc": m["tracking_gain"],
    }


def main() -> int:
    demos = [
        {"label": "open catch-shoot 3", "shot_distance": 25, "is_3": 1,
         "shot_clock": 14, "pre_def_dist": 7.5, "pre_def_angle": 120,
         "pre_help_defenders": 0, "release_height": 10.2},
        {"label": "tightly contested 3 (defender in the line)", "shot_distance": 25,
         "is_3": 1, "shot_clock": 4, "pre_def_dist": 2.0, "pre_def_angle": 12,
         "pre_help_defenders": 1, "release_height": 10.2},
        {"label": "open rim layup", "shot_distance": 2, "is_3": 0,
         "shot_clock": 16, "pre_def_dist": 6.0, "pre_def_angle": 90},
    ]
    for d in demos:
        r = predict(d)
        print(f"  {d['label']:42} -> {r['probability']:.3f}  {r['quality']}")
    r = predict(demos[0])
    print(f"\n  model {r['model']} | test AUC {r['test_auc']} | "
          f"tracking gain {r['tracking_gain_auc']:+.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
