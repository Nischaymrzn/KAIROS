"""Load the serialised production model and predict for one shot scenario.
Returns probability, quality label, and top SHAP factors. This is the single
function the planned FastAPI service wraps.

CLI smoke test:  python -m src.serve.predict
"""
from __future__ import annotations
import json

import joblib
import numpy as np
import pandas as pd

from src.config import get_config
from src.features.build import engineer_features
from src.models.registry import predict_proba
from src.models.calibrate import apply_calibrator

_STATE = None

# Whether the core model can respond to defender distance at all. This is a
# property of the FITTED model, not a constant: the feature is real only for
# 2014-15 and 2015-16, so it carries signal exactly when the training window
# includes them. Reading it from the fitted feature list means the claim on
# /model-info can never drift from the artefact the way a hardcoded flag did.
# Contest analysis for other seasons still lives behind /defend.
# probe scenario for the sensitivity check: a jump shot far enough from the rim
# that contest is the plausible swing factor
_PROBE = {"shot_distance": 24.0, "loc_x": 0.0, "loc_y": 24.0,
          "basic_zone": "Above the Break 3", "zone_range": "24+ ft.",
          "action_type": "Jump Shot", "shot_type": "3PT Field Goal",
          "quarter": 1, "mins_left": 8, "secs_left": 30,
          "position_group": "G", "player_id": 0}


def core_model_is_contest_sensitive(meta: dict | None = None) -> bool:
    """Does moving the defender actually change this model's output?

    Measured by running the model, not inferred from the feature list. A model
    can carry `defender_distance` in its schema and still be blind to it: v7
    listed the column but was trained while it was a constant, so no split on it
    exists and the served value is ignored. Only the model can answer this, and
    the answer is cached for the life of the loaded state.
    """
    st = _load()
    if "contest_sensitive" not in st:
        lo = _scenario_to_features(dict(_PROBE, defender_distance=1.0), st)
        hi = _scenario_to_features(dict(_PROBE, defender_distance=8.0), st)
        delta = abs(float(predict_proba(st["base"], hi)[0])
                    - float(predict_proba(st["base"], lo)[0]))
        st["contest_sensitive"] = delta > 1e-6
    return st["contest_sensitive"]


def _load_feature_meta(cfg) -> dict:
    """Feature schema for serving. Prefer the training-workspace copy; fall back
    to the FROZEN production bundle (models/production/latest.json -> vN/), so
    serving keeps working when experiments rebuild the workspace. The bundle is
    the deployable artifact; data/processed is scratch."""
    work = cfg.path("data_processed") / "feature_meta.json"
    if work.exists():
        return json.loads(work.read_text())
    prod = cfg.path("models") / "production"
    latest = prod / "latest.json"
    if latest.exists():
        version = json.loads(latest.read_text())["version"]
        frozen = prod / f"v{version}" / "feature_meta.json"
        if frozen.exists():
            return json.loads(frozen.read_text())
    raise FileNotFoundError(
        "feature_meta.json not found in data/processed or the production bundle")


def _load():
    global _STATE
    if _STATE is not None:
        return _STATE
    cfg = get_config()
    m = cfg.path("models")
    cal = joblib.load(m / "calibrated_best.joblib")
    base = joblib.load(m / f"{cal['base_name']}.joblib")
    zone = joblib.load(m / "zone_fg.joblib")
    freq = joblib.load(m / "player_freq.joblib")
    freq_default = float(np.median(list(freq.values()))) if freq else 0.0
    player_lookup = joblib.load(m / "player_lookup.joblib")
    meta = _load_feature_meta(cfg)
    explainer = None
    try:
        from src.models.explain import Explainer
        explainer = Explainer(cfg)
    except Exception:  # SHAP optional
        pass
    _STATE = dict(cfg=cfg, cal=cal, base=base, zone=zone, freq=freq,
                  freq_default=freq_default, player_lookup=player_lookup,
                  meta=meta, explainer=explainer)
    return _STATE


def _quality(p: float, bands) -> str:
    if p >= bands.excellent: return "Excellent"
    if p >= bands.good: return "Good"
    if p >= bands.average: return "Average"
    if p >= bands.poor: return "Poor"
    return "Very Poor"


def _scenario_to_features(s: dict, st) -> pd.DataFrame:
    raw = pd.DataFrame([{
        "SHOT_DISTANCE": s.get("shot_distance", 14.0),
        "LOC_X": s.get("loc_x", 0.0), "LOC_Y": s.get("loc_y", 12.0),
        "BASIC_ZONE": s.get("basic_zone", "Mid-Range"),
        "ZONE_RANGE": s.get("zone_range", "16-24 ft."),
        "ACTION_TYPE": s.get("action_type", "Pullup Jump shot"),
        "SHOT_TYPE": s.get("shot_type", "2PT Field Goal"),
        "QUARTER": s.get("quarter", 1),
        "MINS_LEFT": s.get("mins_left", 8), "SECS_LEFT": s.get("secs_left", 30),
        "POSITION_GROUP": s.get("position_group", "G"),
        "PLAYER_ID": s.get("player_id", 0),
    }])
    feats, _ = engineer_features(raw)

    # apply optional real context (overriding the imputed defaults)
    #
    # The defender override is live again when the fitted model carries a
    # defender_distance split, which it does whenever 2014-15 / 2015-16 are in
    # the training window (see src/data/contest.py). Setting the imputed flag to
    # 0 puts the row on the same pathway as the seasons where the measurement is
    # real. When the window excludes those seasons the feature is dropped as a
    # constant and this override is inert, which
    # `core_model_is_contest_sensitive()` reports rather than asserts.
    if s.get("defender_distance") is not None:
        d = float(s["defender_distance"])
        feats["defender_distance"] = np.float32(d)
        feats["defender_distance_is_imputed"] = np.int8(0)
        cat = "heavy" if d < 2 else "contested" if d < 4 else "light" if d < 6 else "open"
        feats["contest_category"] = pd.Categorical(
            [cat], categories=["heavy", "contested", "light", "open"])
    if s.get("shot_clock") is not None:
        sc = float(s["shot_clock"])
        feats["shot_clock"] = np.float32(sc)
        feats["shot_clock_is_imputed"] = np.int8(0)
        feats["shot_clock_urgency"] = np.float32(((5 - sc) / 5) ** 2 if sc < 5 else 0.0)
    if s.get("score_margin") is not None:
        feats["score_margin"] = np.float32(float(s["score_margin"]))
        feats["score_margin_is_imputed"] = np.int8(0)

    # train-fit tables
    rate, glob = st["zone"]["rate"], st["zone"]["glob"]
    key = (s.get("basic_zone", "Mid-Range"), s.get("zone_range", "16-24 ft."))
    zfg = float(rate.get(key, glob)) if hasattr(rate, "get") else glob
    feats["zone_fg_pct"] = np.float32(zfg)
    feats["xp"] = np.float32(zfg * (3 if feats["is_3pt"].iloc[0] else 2))

    # inject this player's real profile + tracking + skill (else dataset means).
    # player_freq / player_fg_pct / player_3p_pct are created here (they are
    # added post-split in build.py, so engineer_features does not produce them).
    pl = st["player_lookup"]
    prow = pl["table"].get(int(s.get("player_id", 0))) or pl["default"]
    for col, val in prow.items():
        feats[col] = np.float32(val)
    return feats


def predict(scenario: dict) -> dict:
    st = _load()
    feats = _scenario_to_features(scenario, st)  # full frame; transformers select cols
    p_base = predict_proba(st["base"], feats)
    p = float(apply_calibrator(st["cal"], p_base)[0])
    factors = st["explainer"].explain_one(feats) if st["explainer"] else []
    return {
        "probability": round(p, 4),
        "quality": _quality(p, st["cfg"].quality_bands),
        "factors": factors,
    }


def _batch_features(scenarios: list[dict], st) -> pd.DataFrame:
    """Build the feature frame for many scenarios in one engineer_features call.

    Per-shot context (defender distance / shot clock / score margin) is applied
    when a scenario carries it, exactly as `_scenario_to_features` does for one
    row, and left imputed when it does not.

    It used to be dropped unconditionally, on the reasoning that the Explorer grid
    is a spatial map rather than a contest study. That is true of the grid, which
    passes no context and is unaffected. It was not true of every caller: ranking
    the nine shot options at a spot is a batch, and it is a batch whose whole
    purpose is to rank them UNDER the current contest and clock. Silently imputing
    those made the ranking answer a different question than the one asked, and it
    matched the single-row path closely enough that nothing looked wrong."""
    raw = pd.DataFrame([{
        "SHOT_DISTANCE": s.get("shot_distance", 14.0),
        "LOC_X": s.get("loc_x", 0.0), "LOC_Y": s.get("loc_y", 12.0),
        "BASIC_ZONE": s.get("basic_zone", "Mid-Range"),
        "ZONE_RANGE": s.get("zone_range", "16-24 ft."),
        "ACTION_TYPE": s.get("action_type", "Pullup Jump shot"),
        "SHOT_TYPE": s.get("shot_type", "2PT Field Goal"),
        "QUARTER": s.get("quarter", 1),
        "MINS_LEFT": s.get("mins_left", 8), "SECS_LEFT": s.get("secs_left", 30),
        "POSITION_GROUP": s.get("position_group", "G"),
        "PLAYER_ID": s.get("player_id", 0),
    } for s in scenarios])
    feats, _ = engineer_features(raw)

    # ---- per-shot context, vectorised -------------------------------------
    # Same overrides as the single-row path, applied only to the rows that carry
    # a value so a mixed batch behaves like the rows would individually.
    def _col(key):
        vals = [s.get(key) for s in scenarios]
        return vals, any(v is not None for v in vals)

    dvals, any_d = _col("defender_distance")
    if any_d:
        cur = feats["defender_distance"].to_numpy(dtype="float32").copy()
        imp = feats["defender_distance_is_imputed"].to_numpy().copy()
        cats = ["heavy", "contested", "light", "open"]
        cat_col = list(feats["contest_category"].astype(str))
        for i, v in enumerate(dvals):
            if v is None:
                continue
            d = float(v)
            cur[i] = d
            imp[i] = 0
            cat_col[i] = ("heavy" if d < 2 else "contested" if d < 4
                          else "light" if d < 6 else "open")
        feats["defender_distance"] = cur
        feats["defender_distance_is_imputed"] = imp.astype("int8")
        feats["contest_category"] = pd.Categorical(cat_col, categories=cats)

    svals, any_s = _col("shot_clock")
    if any_s:
        cur = feats["shot_clock"].to_numpy(dtype="float32").copy()
        imp = feats["shot_clock_is_imputed"].to_numpy().copy()
        urg = feats["shot_clock_urgency"].to_numpy(dtype="float32").copy()
        for i, v in enumerate(svals):
            if v is None:
                continue
            sc = float(v)
            cur[i] = sc
            imp[i] = 0
            urg[i] = ((5 - sc) / 5) ** 2 if sc < 5 else 0.0
        feats["shot_clock"] = cur
        feats["shot_clock_is_imputed"] = imp.astype("int8")
        feats["shot_clock_urgency"] = urg

    mvals, any_m = _col("score_margin")
    if any_m:
        cur = feats["score_margin"].to_numpy(dtype="float32").copy()
        imp = feats["score_margin_is_imputed"].to_numpy().copy()
        for i, v in enumerate(mvals):
            if v is None:
                continue
            cur[i] = float(v)
            imp[i] = 0
        feats["score_margin"] = cur
        feats["score_margin_is_imputed"] = imp.astype("int8")

    # train-fit zone table (vectorised lookup)
    rate, glob = st["zone"]["rate"], st["zone"]["glob"]
    keys = zip(raw["BASIC_ZONE"], raw["ZONE_RANGE"])
    zfg = np.array([float(rate.get(k, glob)) if hasattr(rate, "get") else glob
                    for k in keys], dtype="float32")
    feats["zone_fg_pct"] = zfg
    pts = np.where(feats["is_3pt"].to_numpy() == 1, 3.0, 2.0)
    feats["xp"] = (zfg * pts).astype("float32")

    # per-player profile/tracking/skill (else dataset means), one row per shot
    pl = st["player_lookup"]
    prows = [pl["table"].get(int(pid)) or pl["default"]
             for pid in raw["PLAYER_ID"].astype(int)]
    pdf = pd.DataFrame(prows)
    for col in pdf.columns:
        feats[col] = pdf[col].to_numpy(dtype="float32")
    return feats


def predict_batch(scenarios: list[dict]) -> list[dict]:
    """Vectorised prediction for many scenarios (no SHAP) — for the Shot
    Explorer grid. One feature build + one model call over all rows."""
    st = _load()
    if not scenarios:
        return []
    rows = _batch_features(scenarios, st)
    p = apply_calibrator(st["cal"], predict_proba(st["base"], rows))
    return [{"probability": round(float(pi), 4),
             "quality": _quality(float(pi), st["cfg"].quality_bands)}
            for pi in p]


def main() -> int:
    import time
    # Tier A has no real defender distance (constant), so we don't override it
    # here — the model uses the trained zone/distance/shot-type signal.
    demos = [
        {"action_type": "Driving Layup Shot", "shot_type": "2PT Field Goal",
         "basic_zone": "Restricted Area", "zone_range": "Less Than 8 ft.",
         "shot_distance": 2, "loc_x": 0, "loc_y": 8},
        {"action_type": "Step Back Jump shot", "shot_type": "3PT Field Goal",
         "basic_zone": "Above the Break 3", "zone_range": "24+ ft.",
         "shot_distance": 26, "loc_x": 60, "loc_y": 240},
    ]
    t = time.time()
    for d in demos:
        r = predict(d)
        ms = (time.time() - t) * 1000
        print(f"{d['action_type']:22} -> {r['probability']:.3f} {r['quality']:8} "
              f"top: {[f['feature'] for f in r['factors'][:3]]}  ({ms:.0f}ms)")
        t = time.time()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
