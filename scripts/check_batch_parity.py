"""Batch parity — predict_batch must agree with predict, row for row.

WHY THIS EXISTS. `_batch_features` originally dropped the per-shot context
(defender distance, shot clock, score margin) on the reasoning that its only
caller was the Explorer grid, which is a spatial map and passes none. A second
caller then appeared: ranking the nine shot options at a spot, which is a batch
whose entire purpose is to rank them UNDER the current contest and clock.

The failure was silent and nearly invisible. The batch returned plausible
probabilities in the right order, just answering a different question — the
contested pull-up scored as an uncontested one. Nothing errored, nothing looked
wrong, and the only way to catch it was to compare the two paths directly.

So that comparison is a test. Any future batch feature that forgets a column the
single path applies fails here instead of shipping.

    python scripts/check_batch_parity.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# run as `python scripts/check_batch_parity.py` from the repo root, so the
# package root has to be on the path before the project imports resolve
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.serve.predict import predict, predict_batch
from backend.services.adapter import court_to_scenario, ACTION_MAP

TOL = 1e-6


def main() -> int:
    fails = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal fails
        if not cond:
            fails += 1
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'   ' + detail if detail else ''}")

    # ---- with full context: the case that was wrong -------------------------
    print("batch matches single when the scenario carries context")
    court = {"x": -26, "z": 4, "playerId": 0, "positionGroup": "G",
             "quarter": 1, "shotClock": 12, "scoreMargin": 0, "defenderDistance": 3}
    verbs = list(ACTION_MAP)
    scens = [court_to_scenario({**court, "shotType": v}) for v in verbs]
    batched = predict_batch(scens)
    for v, s, b in zip(verbs, scens, batched):
        one = predict(s)["probability"]
        check(v, abs(one - b["probability"]) < TOL,
              f"{b['probability']:.4f} vs {one:.4f}")

    # ---- without context: the grid path must be untouched --------------------
    print("\nbatch matches single when no context is supplied")
    grid = [court_to_scenario({"x": -22, "z": z, "shotType": "catch_shoot"})
            for z in (-8, 0, 8, 16)]
    gb = predict_batch(grid)
    for i, (s, b) in enumerate(zip(grid, gb)):
        one = predict(s)["probability"]
        check(f"grid row {i}", abs(one - b["probability"]) < TOL,
              f"{b['probability']:.4f} vs {one:.4f}")

    # ---- a mixed batch: some rows carry context, some do not ------------------
    print("\na mixed batch behaves like the rows would individually")
    mixed = [
        court_to_scenario({"x": -26, "z": 4, "shotType": "pullup", "defenderDistance": 1.5}),
        court_to_scenario({"x": -26, "z": 4, "shotType": "pullup"}),
        court_to_scenario({"x": -26, "z": 4, "shotType": "pullup", "defenderDistance": 9}),
    ]
    mb = predict_batch(mixed)
    for i, (s, b) in enumerate(zip(mixed, mb)):
        one = predict(s)["probability"]
        check(f"mixed row {i}", abs(one - b["probability"]) < TOL,
              f"{b['probability']:.4f} vs {one:.4f}")

    # and the contest must actually separate them, or the override did nothing
    check("a tight row scores below an open row in the same batch",
          mb[0]["probability"] < mb[2]["probability"],
          f"{mb[0]['probability']:.4f} tight vs {mb[2]['probability']:.4f} open")

    print("\nall batch parity checks passed" if fails == 0 else f"\n{fails} FAILURES")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
