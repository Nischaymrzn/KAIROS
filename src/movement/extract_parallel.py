"""Parallel trajectory extraction — scale model 2's dataset beyond the 60-game
pilot. Reuses the exact windowing/featurisation of `src.movement.extract` but
distributes games across worker processes (each decompresses one 7z, aligns its
shots, builds waypoint sequences). Produces the same artifacts the rest of the
movement pipeline consumes (`sequences.npz`, `trajectories.parquet`, manifest).

CLI:  python -m src.movement.extract_parallel --games 300 --workers 5
"""
from __future__ import annotations
import argparse
import json
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import get_config
from src.movement.extract import (game_files, load_shot_events, read_game_json,
                                  collect_moments, moment_arrays, build_waypoints,
                                  WAYPOINT_COLS, LABEL_COLS)

_SHOTS = None
_MV = None


def _init_worker():
    global _SHOTS, _MV
    cfg = get_config()
    s = load_shot_events(cfg)
    _SHOTS = {int(g): d for g, d in s.groupby("GAME_ID")}
    _MV = cfg.movement


def _process_game(fp: str) -> dict:
    rows, seqs, lengths, labels = [], [], [], []
    kept = skipped = 0
    with tempfile.TemporaryDirectory() as tmp:
        game = read_game_json(Path(fp), tmp)
        if game is None:
            return {"rows": rows, "seqs": seqs, "lengths": lengths,
                    "labels": labels, "kept": 0, "skipped": 0}
        try:
            gid = int(game["gameid"])
        except (KeyError, ValueError, TypeError):
            return {"rows": rows, "seqs": seqs, "lengths": lengths,
                    "labels": labels, "kept": 0, "skipped": 0}
        g_shots = (_SHOTS or {}).get(gid)
        if g_shots is None:
            return {"rows": rows, "seqs": seqs, "lengths": lengths,
                    "labels": labels, "kept": 0, "skipped": 0}
        max_len, min_frames, window = (int(_MV.max_len), int(_MV.min_frames),
                                       float(_MV.window_sec))
        for _, sh in g_shots.iterrows():
            try:
                mts = collect_moments(game, int(sh["PERIOD"]), float(sh["SHOT_TIME"]),
                                      float(sh["SHOT_TIME"]) + window, int(sh["PLAYER_ID"]))
                if len(mts) < min_frames:
                    skipped += 1
                    continue
                wp = build_waypoints(moment_arrays(mts, int(sh["PLAYER_ID"])), max_len)
                if wp is None or len(wp) < min_frames:
                    skipped += 1
                    continue
            except Exception:
                skipped += 1
                continue
            kept += 1
            lab = {k: sh[k] for k in LABEL_COLS}
            for step, row in enumerate(wp):
                rows.append({**lab, "step": step, **dict(zip(WAYPOINT_COLS, row))})
            L = len(wp)
            if L < max_len:
                wp = np.vstack([wp, np.zeros((max_len - L, wp.shape[1]), "float32")])
            seqs.append(wp)
            lengths.append(L)
            labels.append(lab)
    return {"rows": rows, "seqs": seqs, "lengths": lengths, "labels": labels,
            "kept": kept, "skipped": skipped}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=300, help="0 = all")
    ap.add_argument("--workers", type=int, default=5)
    args = ap.parse_args()

    cfg = get_config()
    files = [str(f) for f in game_files(cfg)]
    if args.games:
        files = files[: args.games]
    out_dir = cfg.path("data_movement")
    print(f"extracting trajectories from {len(files)} games, {args.workers} workers")

    all_rows, seqs, lengths, labels = [], [], [], []
    kept = skipped = done = 0
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=args.workers, initializer=_init_worker) as ex:
        futs = [ex.submit(_process_game, f) for f in files]
        for fut in as_completed(futs):
            r = fut.result()
            all_rows.extend(r["rows"])
            seqs.extend(r["seqs"])
            lengths.extend(r["lengths"])
            labels.extend(r["labels"])
            kept += r["kept"]
            skipped += r["skipped"]
            done += 1
            if done % 20 == 0 or done == len(files):
                el = time.time() - t0
                print(f"  {done}/{len(files)} games | {kept:,} trajectories | "
                      f"{el/60:.1f} min, ~{el/done*(len(files)-done)/60:.0f} min left",
                      flush=True)

    if not seqs:
        print("  no trajectories extracted")
        return 1
    pd.DataFrame(all_rows).to_parquet(out_dir / "trajectories.parquet", index=False)
    np.savez(out_dir / "sequences.npz",
             seq=np.stack(seqs), lengths=np.asarray(lengths, "int32"),
             game_id=np.asarray([int(l["GAME_ID"]) for l in labels], "int32"),
             made=np.asarray([int(l["SHOT_MADE_FLAG"]) for l in labels], "int32"),
             action=np.asarray([str(l["ACTION_TYPE"]) for l in labels]))
    manifest = {"games": len(files), "kept": kept, "skipped": skipped,
                "max_len": int(cfg.movement.max_len),
                "window_sec": float(cfg.movement.window_sec),
                "features": WAYPOINT_COLS}
    (out_dir / "extract_manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\n  wrote {kept:,} trajectories from "
          f"{len(np.unique([l['GAME_ID'] for l in labels]))} games -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
