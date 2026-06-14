"""Repair the corrupted speed channel in the already-extracted movement data.

`src/movement/extract.py` computed speed as distance/dt with dt floored at
1e-3 s. The SportVU game clock stalls across duplicate frames, so that floor
turned stalled intervals into speeds of 1000x the step: 27,605 of the 1.08 M
frames were physically impossible and the column topped out at 83,097 ft/s.

The source is fixed, but re-extracting means another pass over the raw 15 GB
corpus at roughly a minute a game. Positions are sound — they stay inside the
94 x 50 ft court — so speed is recomputed from position here instead, which
takes seconds and produces the same numbers a clean extract would.

Two artifacts carry the channel:

    data/movement/trajectories.parquet   the `speed` column
    data/movement/sequences.npz          seq[:, :, 3], the GRU's input channel 3

The second is why this matters beyond cosmetics: the movement model was trained
with 2.91% of one input feature corrupted.

Originals are kept alongside as *.corrupt-speed.* so the repair is reversible
and the before/after is auditable.

Run: python -m src.movement.repair_speed
"""
from __future__ import annotations

import json
import shutil

import numpy as np
import pandas as pd

from src.config import get_config

MIN_FRAME_DT = 0.04     # 25 Hz; anything shorter is a stalled clock
MAX_SPEED_FTS = 32.0    # NBA top speed is ~24 ft/s


def _describe(a: np.ndarray, label: str) -> dict:
    a = a[np.isfinite(a)]
    nz = a[a > 0]
    return {
        "label": label,
        "median": round(float(np.median(nz)), 2) if nz.size else 0.0,
        "p90": round(float(np.percentile(nz, 90)), 2) if nz.size else 0.0,
        "p99": round(float(np.percentile(nz, 99)), 2) if nz.size else 0.0,
        "max": round(float(a.max()), 1) if a.size else 0.0,
        "impossible_frames": int((a > MAX_SPEED_FTS).sum()),
        "impossible_pct": round(float((a > MAX_SPEED_FTS).mean() * 100), 3),
    }


def _speed_from_xy(x: np.ndarray, y: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Per-step speed from position, with a real dt floor and a physical cap."""
    d = np.concatenate([[0.0], np.hypot(np.diff(x), np.diff(y))])
    dt = np.concatenate([[MIN_FRAME_DT], np.diff(t)])
    dt = np.where(dt < MIN_FRAME_DT, MIN_FRAME_DT, dt)
    return np.clip(d / dt, 0.0, MAX_SPEED_FTS)


def repair() -> dict:
    cfg = get_config()
    d = cfg.path("data_movement")
    report: dict = {}

    # ---- trajectories.parquet ----------------------------------------------
    tp = d / "trajectories.parquet"
    if tp.exists():
        backup = tp.with_suffix(".corrupt-speed.parquet")
        if not backup.exists():
            shutil.copy2(tp, backup)

        df = pd.read_parquet(tp)
        before = _describe(df["speed"].to_numpy("float64"), "trajectories.speed before")

        df = df.sort_values(["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "step"])
        fixed = np.empty(len(df), dtype="float32")
        pos = 0
        for _, g in df.groupby(["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID"], sort=False):
            n = len(g)
            fixed[pos:pos + n] = _speed_from_xy(
                g["x"].to_numpy("float64"), g["y"].to_numpy("float64"),
                g["t"].to_numpy("float64"))
            pos += n
        df["speed"] = fixed
        df.to_parquet(tp, index=False)

        after = _describe(fixed.astype("float64"), "trajectories.speed after")
        report["trajectories"] = {"before": before, "after": after, "rows": int(len(df))}

    # ---- sequences.npz (the GRU's training input) --------------------------
    sp = d / "sequences.npz"
    if sp.exists():
        backup = sp.with_name("sequences.corrupt-speed.npz")
        z = np.load(sp, allow_pickle=True)
        arrays = {k: z[k] for k in z.files}
        if not backup.exists():
            np.savez_compressed(backup, **arrays)

        seq = arrays["seq"].astype("float32")       # (N, T, 8): x y t speed ...
        lengths = arrays["lengths"].astype(int)
        before = _describe(seq[:, :, 3].ravel().astype("float64"), "sequences.speed before")

        for i, L in enumerate(lengths):
            L = int(max(L, 1))
            s = _speed_from_xy(
                seq[i, :L, 0].astype("float64"),
                seq[i, :L, 1].astype("float64"),
                seq[i, :L, 2].astype("float64"))
            seq[i, :L, 3] = s
            seq[i, L:, 3] = 0.0
        arrays["seq"] = seq
        np.savez_compressed(sp, **arrays)

        after = _describe(seq[:, :, 3].ravel().astype("float64"), "sequences.speed after")
        report["sequences"] = {"before": before, "after": after,
                               "n_sequences": int(seq.shape[0])}

    # ---- shots_tracking.parquet (the tracking study model's input) ---------
    # Same bug, different extractor. This file holds derived scalars with no
    # positions to recompute from, so the only honest repair is the physical cap
    # the player-set extractor already applies at 40 ft/s. Model 2 was trained on
    # the uncapped values and needs `make tracking-model` to benefit.
    st = d / "shots_tracking.parquet"
    if st.exists():
        backup = st.with_suffix(".corrupt-speed.parquet")
        if not backup.exists():
            shutil.copy2(st, backup)

        df = pd.read_parquet(st)
        cols = [c for c in ("pre_shooter_speed", "pre_closing_speed") if c in df.columns]
        info = {}
        for c in cols:
            a = df[c].to_numpy("float64")
            info[c] = {"before": _describe(a, f"{c} before")}
            df[c] = np.clip(a, 0.0, MAX_SPEED_FTS)
            info[c]["after"] = _describe(df[c].to_numpy("float64"), f"{c} after")
        df.to_parquet(st, index=False)
        report["shots_tracking"] = {"columns": info, "rows": int(len(df)),
                                    "method": "clipped (no positions to recompute from)"}

    out = cfg.path("reports") / "figures" / "movement_speed_repair.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    repair()
