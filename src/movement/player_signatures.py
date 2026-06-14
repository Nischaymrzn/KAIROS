"""Per-player movement signatures from the 2015-16 SportVU tracking corpus.

The served movement model is league-wide: it clusters all 45,100 tracked
approaches into shared templates and rolls a GRU from them, so every player
arrives at a spot the same way. That is fine for "what does an approach look
like" and wrong for "how does *this* player get there".

This builds, for each player with enough tracked approaches, a small set of
their OWN real paths — not a model output, not an average, but actual medoid
sequences that player ran — indexed by where the shot was taken from and by how
much defensive pressure was on at release. Retrieval at serve time then answers
a question the league model cannot: how does this player attack this spot when
someone is in his chest, versus when he is open.

Two honest limits, both properties of the extracted corpus rather than choices:

  1. Only the SHOOTER is tracked through time. `trajectories.parquet` holds one
     path per shot. The other nine players exist only as a single frame at the
     instant of release (`shots_players.npz`), so a full ten-player replay is
     not reconstructible from these artifacts — it needs a fresh pass over the
     raw 15 GB corpus.
  2. Defender context is `def_dist`, the distance to the NEAREST defender at
     each frame. Which defender that is, and where he is, is not retained.

Output: models/movement/player_moves.npz

    player_id   (P,)              int64
    n_seq       (P,)              int32     tracked approaches for this player
    paths       (P, B, K, T, 2)   float32   medoid paths, SportVU feet
    valid       (P, B, K)         int8      whether that slot was filled
    release     (P, B, K, 2)      float32   where each medoid path ends
    speed       (P, B, K, T)      float32   per-step speed along the medoid
    stats       (P, 5)            float32   see STAT_NAMES

Run: python -m src.movement.player_signatures
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from src.config import get_config

# defender distance at release, feet. Bin edges chosen so each holds thousands
# of sequences league-wide (8.3k / 9.1k / 13.7k / 13.8k).
PRESSURE_BINS = [(0.0, 3.0), (3.0, 5.0), (5.0, 8.0), (8.0, np.inf)]
PRESSURE_NAMES = ["smother", "tight", "open", "free"]

MIN_SEQ = 25          # a player below this has no stable signature
MAX_PER_BIN = 4       # medoid paths kept per player per pressure bin
T_STEPS = 24          # matches the extractor's max_len

STAT_NAMES = ["median_speed", "peak_speed", "directness", "mean_def_dist", "drive_share"]

# The extractor's `speed` column is distance/dt, and 27,605 of the 1.08 M frames
# carry dt = 0, so 2.8% of it is physically impossible — the column tops out at
# 83,097 ft/s. Positions are sound (they stay inside the 94 x 50 ft court), so
# speed is recomputed here from position with dt floored at the median frame
# interval, then capped. NBA top speed is about 24 ft/s; 32 is generous headroom
# and still rejects the glitches.
FRAME_DT = 0.16          # median SportVU frame interval in this corpus, seconds
SPEED_CAP_FTS = 32.0


def _speed_from_path(xy: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Per-step speed recomputed from position, immune to collapsed dt."""
    d = np.concatenate([[0.0], np.hypot(np.diff(xy[:, 0]), np.diff(xy[:, 1]))])
    dt = np.concatenate([[FRAME_DT], np.diff(t)])
    dt = np.where(dt < FRAME_DT * 0.5, FRAME_DT, dt)
    return np.clip(d / dt, 0.0, SPEED_CAP_FTS).astype("float32")


def _resample(path: np.ndarray, n: int = T_STEPS) -> np.ndarray:
    """Resample a variable-length path to n points by arc length."""
    if len(path) == n:
        return path.astype("float32")
    if len(path) < 2:
        return np.repeat(path[:1], n, axis=0).astype("float32")
    seg = np.hypot(np.diff(path[:, 0]), np.diff(path[:, 1]))
    s = np.concatenate([[0.0], np.cumsum(seg)])
    if s[-1] <= 1e-6:
        return np.repeat(path[:1], n, axis=0).astype("float32")
    u = np.linspace(0.0, s[-1], n)
    return np.stack([np.interp(u, s, path[:, 0]), np.interp(u, s, path[:, 1])], 1).astype("float32")


def _medoids(paths: np.ndarray, k: int) -> list[int]:
    """Indices of up to k paths that best cover the group.

    Medoids rather than centroids on purpose: an averaged path is not a path
    anyone ran, and averaging curved drives from both sides of the floor
    produces a straight line through the middle that is physically wrong.
    """
    n = len(paths)
    if n <= k:
        return list(range(n))
    flat = paths.reshape(n, -1)
    # farthest-point selection: spread the picks rather than clustering them
    picked = [int(np.argmin(np.linalg.norm(flat - flat.mean(0), axis=1)))]
    d = np.linalg.norm(flat - flat[picked[0]], axis=1)
    while len(picked) < k:
        nxt = int(np.argmax(d))
        if d[nxt] <= 1e-6:
            break
        picked.append(nxt)
        d = np.minimum(d, np.linalg.norm(flat - flat[nxt], axis=1))
    return picked


def build() -> dict:
    cfg = get_config()
    src = cfg.path("data_movement") / "trajectories.parquet"
    if not src.exists():
        raise FileNotFoundError(f"{src} — run `make movement-extract` first")

    df = pd.read_parquet(
        src,
        columns=["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "ACTION_TYPE",
                 "step", "x", "y", "t", "speed", "def_dist"],
    ).sort_values(["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "step"])

    keys = ["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID"]
    counts = df.groupby("PLAYER_ID")[keys[0]].count()

    seqs: dict[int, list[dict]] = {}
    for (_, _, pid), g in df.groupby(keys, sort=False):
        if counts.get(pid, 0) < MIN_SEQ:
            continue
        xy = g[["x", "y"]].to_numpy("float32")
        if len(xy) < 4:
            continue
        seqs.setdefault(int(pid), []).append({
            "xy": xy,
            "speed": _speed_from_path(xy, g["t"].to_numpy("float32")),
            "def_release": float(g["def_dist"].iloc[-1]),
            "def_mean": float(g["def_dist"].mean()),
            "action": str(g["ACTION_TYPE"].iloc[0]),
        })

    players = sorted(p for p, v in seqs.items() if len(v) >= MIN_SEQ)
    P, B, K, T = len(players), len(PRESSURE_BINS), MAX_PER_BIN, T_STEPS
    paths = np.zeros((P, B, K, T, 2), "float32")
    speed = np.zeros((P, B, K, T), "float32")
    release = np.zeros((P, B, K, 2), "float32")
    valid = np.zeros((P, B, K), "int8")
    n_seq = np.zeros(P, "int32")
    stats = np.zeros((P, len(STAT_NAMES)), "float32")

    for pi, pid in enumerate(players):
        rows = seqs[pid]
        n_seq[pi] = len(rows)

        allsp = np.concatenate([r["speed"] for r in rows])
        net = np.mean([
            np.hypot(*(r["xy"][-1] - r["xy"][0]))
            / max(np.hypot(np.diff(r["xy"][:, 0]), np.diff(r["xy"][:, 1])).sum(), 1e-6)
            for r in rows
        ])
        drives = np.mean([("Driving" in r["action"] or "Layup" in r["action"]) for r in rows])
        stats[pi] = [float(np.median(allsp)), float(np.percentile(allsp, 95)), net,
                     np.mean([r["def_mean"] for r in rows]), drives]

        for bi, (lo, hi) in enumerate(PRESSURE_BINS):
            grp = [r for r in rows if lo <= r["def_release"] < hi]
            if not grp:
                continue
            res = np.stack([_resample(r["xy"]) for r in grp])
            for slot, idx in enumerate(_medoids(res, K)):
                paths[pi, bi, slot] = res[idx]
                speed[pi, bi, slot] = _resample(
                    np.stack([grp[idx]["speed"], grp[idx]["speed"]], 1)
                )[:, 0]
                release[pi, bi, slot] = res[idx][-1]
                valid[pi, bi, slot] = 1

    out = cfg.path("models") / "movement" / "player_moves.npz"
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out,
        player_id=np.asarray(players, "int64"), n_seq=n_seq, paths=paths,
        valid=valid, release=release, speed=speed, stats=stats,
        stat_names=np.asarray(STAT_NAMES), pressure_names=np.asarray(PRESSURE_NAMES),
        pressure_edges=np.asarray([[lo, hi] for lo, hi in PRESSURE_BINS], "float32"),
    )

    manifest = {
        "players": P,
        "sequences_used": int(n_seq.sum()),
        "min_sequences_per_player": MIN_SEQ,
        "pressure_bins": {
            PRESSURE_NAMES[i]: int(valid[:, i].any(1).sum()) for i in range(B)
        },
        "max_paths_per_bin": K,
        "steps": T,
        "source": "2015-16 SportVU, trajectories.parquet",
        "speed_recomputed": True,
        "speed_cap_fts": SPEED_CAP_FTS,
        "note": "Medoid paths are REAL tracked approaches, not averages or model output. "
                "Only the shooter is tracked through time; the other nine players exist "
                "in the corpus only as a single frame at release.",
    }
    (out.parent / "player_moves_manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))
    print(f"\nwrote {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return manifest


if __name__ == "__main__":
    build()
