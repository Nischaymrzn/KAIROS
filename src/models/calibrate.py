"""Post-hoc calibration of the best discriminating model. Fits isotonic and
Platt (sigmoid) on the validation season, picks the lower-Brier one.

CLI:  python -m src.models.calibrate
"""
from __future__ import annotations
import json

import joblib
import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

from src.config import get_config
from src.dataset import load_processed
from src.models.registry import predict_proba
from src.models.evaluate import metrics, reliability_fig


def _best_model_name(cfg) -> str:
    board = json.loads((cfg.path("models") / "leaderboard.json").read_text())
    return board["models"][0]["name"]


def apply_calibrator(cal: dict, p: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    if cal["method"] == "isotonic":
        return cal["model"].predict(p)
    return cal["model"].predict_proba(p.reshape(-1, 1))[:, 1]


def main() -> int:
    cfg = get_config()
    ds = load_processed(cfg, with_test=False)
    name = _best_model_name(cfg)
    bundle = joblib.load(cfg.path("models") / f"{name}.joblib")
    # Fit the calibrator on val_cal — the chronologically LATEST slice of the
    # validation season, disjoint from the val_fit slice the booster early-stopped
    # on. Predictions on early-stopping data are optimistic, which makes an
    # isotonic map fitted there under-correct on test. With
    # calibration.holdout_frac = 0, val_cal IS the full validation season (v7).
    cal_part = ds.val_cal
    held_out = len(cal_part) < len(ds.val)
    p_val = predict_proba(bundle, cal_part)
    y_val = cal_part["MADE"].values
    base = metrics(y_val, p_val)
    print(f"best model: {name}  (uncalibrated Brier {base['brier']:.4f} on "
          f"{'held-out val_cal' if held_out else 'full validation'}, "
          f"n={len(cal_part):,})")
    if not held_out:
        print("  NOTE: calibrating on the same rows used for early stopping. "
              "Set calibration.holdout_frac (e.g. 0.3) to separate them.")

    iso = IsotonicRegression(out_of_bounds="clip").fit(p_val, y_val)
    platt = LogisticRegression(C=1e6, max_iter=1000).fit(p_val.reshape(-1, 1), y_val)
    cals = {
        "isotonic": {"method": "isotonic", "model": iso},
        "sigmoid": {"method": "sigmoid", "model": platt},
    }
    scored = {}
    for m, cal in cals.items():
        pc = apply_calibrator(cal, p_val)
        scored[m] = metrics(y_val, pc)["brier"]
        print(f"  {m:9} val Brier {scored[m]:.4f}")
    best_m = min(scored, key=scored.get)
    chosen = cals[best_m]
    chosen["base_name"] = name

    p_cal = apply_calibrator(chosen, p_val)
    reliability_fig(
        {"uncalibrated": (y_val, p_val), f"calibrated ({best_m})": (y_val, p_cal)},
        cfg.path("figures") / "calibration_reliability.png",
        "Reliability before/after calibration (validation)")
    joblib.dump(chosen, cfg.path("models") / "calibrated_best.joblib")
    print(f"  chose {best_m}; saved calibrated_best.joblib")

    assert scored[best_m] <= base["brier"] + 1e-6, "calibration did not help"
    print("  ACCEPT: calibrated Brier <= uncalibrated Brier on validation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
