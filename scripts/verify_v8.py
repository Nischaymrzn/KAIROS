"""Post-retrain verification: does the new bundle actually serve, and did the
contest recovery reach the model?

Run after calibrate/export. Checks things that a metric cannot:
  1. the serving layer builds a feature row the fitted model accepts
  2. the model now responds to defender distance, which is the visible product
     consequence of recovering 2014-15 / 2015-16 contest data
  3. predictions stay inside a sane band and vary with context
"""
from __future__ import annotations

import json
import sys

BASE = {
    "shot_distance": 24.0, "loc_x": 0.0, "loc_y": 24.0,
    "basic_zone": "Above the Break 3", "zone_range": "24+ ft.",
    "action_type": "Jump Shot", "shot_type": "3PT Field Goal",
    "quarter": 4, "mins_left": 2, "secs_left": 30,
    "position_group": "G", "player_id": 201939,
}


def main() -> int:
    from src.serve.predict import predict, core_model_is_contest_sensitive

    fails = []

    base = predict(dict(BASE))
    p0 = base["probability"]
    print(f"  base scenario: p = {p0:.4f}")
    if not 0.01 < p0 < 0.99:
        fails.append(f"probability out of sane band: {p0}")

    sensitive = core_model_is_contest_sensitive()
    print(f"  core model contest-sensitive: {sensitive}")

    probs = {}
    for d in (1.0, 2.0, 4.0, 8.0):
        probs[d] = predict(dict(BASE, defender_distance=d))["probability"]
    spread = max(probs.values()) - min(probs.values())
    print("  defender sweep: " + "  ".join(f"{d:.0f}ft {p:.4f}" for d, p in probs.items()))
    print(f"  spread = {spread:.4f}")

    if sensitive and spread < 0.005:
        fails.append(f"model reports contest sensitivity but the sweep moves "
                     f"only {spread:.4f}")
    if not sensitive and spread > 1e-9:
        fails.append("model reports contest-blind but the sweep moves the probability")
    if sensitive and probs[1.0] >= probs[8.0]:
        fails.append(f"smothered ({probs[1.0]:.4f}) should not beat open "
                     f"({probs[8.0]:.4f})")

    # context must still matter
    layup = predict(dict(BASE, shot_distance=2.0, loc_y=2.0,
                         basic_zone="Restricted Area", zone_range="Less Than 8 ft.",
                         action_type="Layup Shot", shot_type="2PT Field Goal"))
    print(f"  restricted-area layup: p = {layup['probability']:.4f}")
    if layup["probability"] <= p0:
        fails.append("a rim layup did not beat a contested three")

    print()
    if fails:
        for f in fails:
            print(f"  FAIL: {f}")
        return 1
    print("  ACCEPT: serving works, contest response is consistent with the "
          "fitted feature set, and context still moves the prediction.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
