"""Extract shooter trajectories from raw 2015-16 SportVU game logs.

Pipeline per game (production path):
  1. Decompress one `.7z` game log (~100 MB JSON) to a temp dir.
  2. Load the shot events for that game from sealneaward's `shots_fixed.csv`,
     which carries the corrected release time (`SHOT_TIME`, in game-clock
     seconds remaining for that period).
  3. For each shot, collect the tracking moments in the window
     [SHOT_TIME, SHOT_TIME + window_sec] of the same period that contain the
     shooter, dedupe on the wall-clock timestamp, and order them forward in
     time (game clock counts DOWN).
  4. Normalise every entity to the LEFT half court (mirror when the shooter
     attacks the right basket) so all trajectories share one frame.
  5. Resample to at most `max_len` waypoints and compute per-step features:
     x, y, t, speed, heading, basket_dist, def_dist, has_ball.
  6. Delete the decompressed JSON and move on (disk stays flat).

Outputs
  data/movement/trajectories.parquet   long format, one row per waypoint
  data/movement/sequences.npz          seq (N, max_len, F) + lengths + labels
  data/movement/extract_manifest.json  games used, shots kept/skipped

CLI:  python -m src.movement.extract [--games N]
"""
from __future__ import annotations
import argparse
import json
import math
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import get_config

BALL_TEAM = -1
BASKET_LEFT = (5.35, 25.0)
COURT_LEN, COURT_WID = 94.0, 50.0
HAS_BALL_DIST = 3.0  # ft between shooter and ball to count as possession

# SportVU samples at 25 Hz; after the extractor's resampling the median interval
# in this corpus is 0.16 s. NBA top speed is about 24 ft/s, so 32 is headroom.
MIN_FRAME_DT = 0.04
MAX_SPEED_FTS = 32.0

WAYPOINT_COLS = ["x", "y", "t", "speed", "heading", "basket_dist",
                 "def_dist", "has_ball"]
LABEL_COLS = ["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "PERIOD",
              "ACTION_TYPE", "SHOT_MADE_FLAG", "SHOT_DISTANCE"]


# ---------------------------------------------------------------- data access

def game_files(cfg) -> list[Path]:
    root = Path(cfg.raw_path("nba_shots_dir")).parents[1]  # .../data
    d = root / "movement_data" / "nba-movement-data" / "data"
    return sorted(d.glob("*.7z"))


def load_shot_events(cfg) -> pd.DataFrame:
    root = Path(cfg.raw_path("nba_shots_dir")).parents[1]
    fp = (root / "movement_data" / "nba-movement-data" / "data" / "shots"
          / "shots_fixed.csv")
    s = pd.read_csv(fp)
    s = s.dropna(subset=["SHOT_TIME"])
    s["GAME_ID"] = pd.to_numeric(s["GAME_ID"], errors="coerce").astype("int64")
    return s


def read_game_json(fp7z: Path, tmpdir: str) -> dict | None:
    import py7zr
    try:
        with py7zr.SevenZipFile(fp7z) as z:
            names = [n for n in z.getnames() if n.endswith(".json")]
            if not names:
                return None
            z.extractall(tmpdir)
        with open(Path(tmpdir) / names[0]) as f:
            return json.load(f)
    except Exception as e:  # noqa: BLE001 — one corrupt archive must not stop the run
        print(f"    skip {fp7z.name}: {e}")
        return None


# ------------------------------------------------------------- moment gather

def collect_moments(game: dict, period: int, t_lo: float, t_hi: float,
                    shooter: int) -> list:
    """All moments in [t_lo, t_hi] game-clock of `period` containing the
    shooter, deduped on wall-clock ts, ordered forward in time."""
    seen, out = set(), []
    for ev in game.get("events", []):
        for m in ev.get("moments", []):
            if m[0] != period or m[2] is None:
                continue
            if not (t_lo <= m[2] <= t_hi) or m[1] in seen:
                continue
            ents = m[5]
            if any(e[1] == shooter for e in ents):
                seen.add(m[1])
                out.append(m)
    out.sort(key=lambda m: -m[2])  # clock counts down = forward in time
    return out


def moment_arrays(moments: list, shooter: int):
    """Per-frame shooter xy, ball xyz, opponent xy list, clock."""
    sx, sy, bx, by, bz, clock, opp = [], [], [], [], [], [], []
    team_of_shooter = None
    for m in moments:
        ents = m[5]
        s = next((e for e in ents if e[1] == shooter), None)
        b = next((e for e in ents if e[0] == BALL_TEAM), None)
        if s is None or b is None:
            continue
        if team_of_shooter is None:
            team_of_shooter = s[0]
        sx.append(s[2]); sy.append(s[3])
        bx.append(b[2]); by.append(b[3]); bz.append(b[4])
        clock.append(m[2])
        opp.append([(e[2], e[3]) for e in ents
                    if e[0] not in (BALL_TEAM, team_of_shooter)])
    return (np.array(sx), np.array(sy), np.array(bx), np.array(by),
            np.array(bz), np.array(clock), opp)


# ------------------------------------------------------------ featurisation

def build_waypoints(arrs, max_len: int) -> np.ndarray | None:
    sx, sy, bx, by, bz, clock, opp = arrs
    n = len(sx)
    if n < 2:
        return None

    # normalise to the LEFT half court (mirror if attacking the right basket)
    if sx[-1] > COURT_LEN / 2:
        sx = COURT_LEN - sx; sy = COURT_WID - sy
        bx = COURT_LEN - bx; by = COURT_WID - by
        opp = [[(COURT_LEN - x, COURT_WID - y) for x, y in row] for row in opp]

    # resample evenly to <= max_len waypoints
    idx = np.linspace(0, n - 1, num=min(n, max_len)).round().astype(int)
    t0 = clock[idx[0]]
    rows = []
    for j, i in enumerate(idx):
        t = float(t0 - clock[i])  # elapsed seconds since window start
        if j == 0:
            speed, heading = 0.0, 0.0
        else:
            p = idx[j - 1]
            dx, dy = float(sx[i] - sx[p]), float(sy[i] - sy[p])
            # The SportVU game clock stalls across duplicate frames, so the raw
            # interval collapses to zero. Flooring at 1e-3 s turned those into
            # speeds of 1000x the step: 27,605 frames of the original extract
            # were physically impossible, topping out at 83,097 ft/s. Floor at a
            # real frame interval and cap at a speed a human can reach.
            dt = float(clock[p] - clock[i])
            if dt < MIN_FRAME_DT:
                dt = MIN_FRAME_DT
            speed = min(math.hypot(dx, dy) / dt, MAX_SPEED_FTS)
            heading = math.atan2(dy, dx)
        dd = (min(math.hypot(sx[i] - ox, sy[i] - oy) for ox, oy in opp[i])
              if opp[i] else 25.0)
        rows.append([
            float(sx[i]), float(sy[i]), t, speed, heading,
            math.hypot(sx[i] - BASKET_LEFT[0], sy[i] - BASKET_LEFT[1]),
            dd,
            1.0 if (math.hypot(sx[i] - bx[i], sy[i] - by[i]) < HAS_BALL_DIST
                    and bz[i] < 10.0) else 0.0,
        ])
    return np.asarray(rows, dtype="float32")


# --------------------------------------------------------------------- main

def extract(cfg=None, n_games: int | None = None) -> dict:
    cfg = cfg or get_config()
    mv = cfg.movement
    files = game_files(cfg)
    n_games = n_games or int(mv.sample_games)
    files = files[:n_games]
    shots = load_shot_events(cfg)
    out_dir = cfg.path("data_movement")

    all_rows, seqs, lengths, labels = [], [], [], []
    kept = skipped = 0
    for gi, fp in enumerate(files, 1):
        with tempfile.TemporaryDirectory() as tmp:
            game = read_game_json(fp, tmp)
            if game is None:
                continue
            gid = int(game["gameid"])
            g_shots = shots[shots["GAME_ID"] == gid]
            if g_shots.empty:
                continue
            for _, sh in g_shots.iterrows():
                mts = collect_moments(game, int(sh["PERIOD"]),
                                      float(sh["SHOT_TIME"]),
                                      float(sh["SHOT_TIME"]) + float(mv.window_sec),
                                      int(sh["PLAYER_ID"]))
                if len(mts) < int(mv.min_frames):
                    skipped += 1
                    continue
                wp = build_waypoints(moment_arrays(mts, int(sh["PLAYER_ID"])),
                                     int(mv.max_len))
                if wp is None or len(wp) < int(mv.min_frames):
                    skipped += 1
                    continue
                kept += 1
                lab = {k: sh[k] for k in LABEL_COLS}
                for step, row in enumerate(wp):
                    all_rows.append({**lab, "step": step,
                                     **dict(zip(WAYPOINT_COLS, row))})
                L = len(wp)
                if L < int(mv.max_len):
                    wp = np.vstack([wp, np.zeros((int(mv.max_len) - L, wp.shape[1]),
                                                 "float32")])
                seqs.append(wp); lengths.append(L); labels.append(lab)
        if gi % 10 == 0 or gi == len(files):
            print(f"  [{gi}/{len(files)}] {fp.name}: kept {kept}, skipped {skipped}")

    traj = pd.DataFrame(all_rows)
    traj.to_parquet(out_dir / "trajectories.parquet", index=False)
    np.savez(out_dir / "sequences.npz",
             seq=np.stack(seqs), lengths=np.asarray(lengths),
             game_id=np.asarray([l["GAME_ID"] for l in labels]),
             made=np.asarray([l["SHOT_MADE_FLAG"] for l in labels]),
             action=np.asarray([str(l["ACTION_TYPE"]) for l in labels]))
    manifest = {"games": len(files), "kept": kept, "skipped": skipped,
                "max_len": int(mv.max_len), "window_sec": float(mv.window_sec),
                "features": WAYPOINT_COLS}
    (out_dir / "extract_manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"  wrote {kept:,} trajectories ({len(traj):,} waypoints) -> {out_dir}")
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=None)
    args = ap.parse_args()
    m = extract(n_games=args.games)
    assert m["kept"] >= 1000, f"too few trajectories: {m['kept']}"
    print("  ACCEPT: >=1000 aligned trajectories extracted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
