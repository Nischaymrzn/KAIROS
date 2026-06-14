"""Shot-level SportVU extraction (2015-16): the real tracking features.

For every shot we can align to the tracking stream, this emits two clearly
separated families of features:

  pre_*   Everything knowable AT OR BEFORE the instant of release:
          closest and second-closest defender distance, the defender's angle
          relative to the shooter->basket line, how many defenders are within
          6 ft, the shooter's speed and whether they were moving toward the
          basket, the REAL shot clock, time spent holding the ball, and the
          release height. These are legitimate shot-quality features.

  post_*  The ball's flight AFTER it leaves the hand: apex height, entry angle
          at the rim, closest approach to the rim centre, flight time.
          **These are the outcome.** A model given them will score AUC > 0.90 and
          be worthless — it cannot run before the shot is taken. They are
          extracted ONLY to power the labelled leakage demonstration
          (`src/studies/leakage_demo.py`). They must never enter a shot-quality
          model; `tests/test_no_leakage.py` enforces this.

Parallelised over games (each worker decompresses one 7z into its own temp dir).

CLI:
    python -m src.movement.extract_shots --games 20        # pilot
    python -m src.movement.extract_shots --games 0 --workers 4   # all 636
Output: data/movement/shots_tracking.parquet
"""
from __future__ import annotations
import argparse
import math
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import get_config
from src.movement.extract import (BALL_TEAM, COURT_LEN,
                                  game_files, load_shot_events, read_game_json)

BASKETS = ((5.35, 25.0), (COURT_LEN - 5.35, 25.0))
RIM_HEIGHT = 10.0
HAS_BALL_DIST = 3.0
PRE_SECS = 3.0        # window before release used for speed / time-with-ball
POST_SECS = 2.0       # window after release used for the ball's flight
HELP_RADIUS = 6.0
RELEASE_SLACK = 1.5   # seconds around the logged SHOT_TIME to hunt for the release


def _nearest_basket(x: float, y: float) -> tuple[float, float]:
    return min(BASKETS, key=lambda b: math.hypot(x - b[0], y - b[1]))


def _moments_for_shot(game: dict, period: int, shot_time: float) -> list:
    """Moments of `period` with game clock in [shot_time-POST, shot_time+PRE],
    deduped on wall-clock ts and ordered forward in time (clock counts down)."""
    lo, hi = shot_time - POST_SECS, shot_time + PRE_SECS
    seen, out = set(), []
    for ev in game.get("events", []):
        for m in ev.get("moments", []):
            if m[0] != period or m[2] is None:
                continue
            if not (lo <= m[2] <= hi) or m[1] in seen:
                continue
            seen.add(m[1])
            out.append(m)
    out.sort(key=lambda m: -m[2])
    return out


def _entities(moment):
    ents = moment[5]
    ball = next((e for e in ents if e[0] == BALL_TEAM), None)
    return ball, [e for e in ents if e[0] != BALL_TEAM]


def _find_release(game: dict, period: int, st: float, shooter: int):
    """Locate the physical release frame for a shot. Returns (moments, idx) or None.

    SHOT_TIME marks the logged shot event, which lags the actual release. Using it
    directly puts us ~1s early, while the defender is still closing (measured:
    defender distance 6.0 ft vs a true 3.7 ft, release height 6.4 ft = ball still
    at chest). So detect the release physically: the LAST frame at or before the
    logged event in which the ball is still in the shooter's hands. Shared by the
    flat-feature extractor and the player-set extractor so both anchor identically.
    """
    moments = _moments_for_shot(game, period, st)
    if len(moments) < 4:
        return None

    anchor = None
    best = 1e9
    for i, m in enumerate(moments):
        if not any(e[1] == shooter for e in m[5]):
            continue
        d = abs(m[2] - st)
        if d < best:
            best, anchor = d, i
    if anchor is None or best > 1.0:
        return None

    # Search the WHOLE window (SHOT_TIME may precede or lag the release) for the
    # last frame in which the ball is still in the shooter's hands, restricted to
    # +/- RELEASE_SLACK seconds of the logged event so a later rebound cannot be
    # mistaken for the release.
    idx = None
    for i, m in enumerate(moments):
        if abs(m[2] - st) > RELEASE_SLACK:
            continue
        b, pl = _entities(m)
        p = next((e for e in pl if e[1] == shooter), None)
        if b is None or p is None:
            continue
        if math.hypot(float(p[2]) - float(b[2]), float(p[3]) - float(b[3])) <= HAS_BALL_DIST:
            idx = i                      # keep the last in-hand frame
    if idx is None:
        idx = anchor
    return moments, idx


def _shot_features(game: dict, shot) -> dict | None:
    period = int(shot["PERIOD"])
    st = float(shot["SHOT_TIME"])
    shooter = int(shot["PLAYER_ID"])
    found = _find_release(game, period, st, shooter)
    if found is None:
        return None
    moments, idx = found

    rel = moments[idx]
    ball, players = _entities(rel)
    s = next((e for e in players if e[1] == shooter), None)
    if ball is None or s is None or len(players) < 6:
        return None

    sx, sy = float(s[2]), float(s[3])
    steam = s[0]
    bz = float(ball[4])
    basket = _nearest_basket(sx, sy)

    # ---- pre-release: defender geometry at the instant of release ----------
    opp = [(float(e[2]), float(e[3])) for e in players if e[0] != steam]
    if not opp:
        return None
    dists = sorted(math.hypot(sx - ox, sy - oy) for ox, oy in opp)
    d1 = dists[0]
    d2 = dists[1] if len(dists) > 1 else 25.0
    help_n = sum(1 for d in dists if d <= HELP_RADIUS)

    # angle between (closest defender - shooter) and (basket - shooter):
    # 0 deg = defender directly between shooter and rim.
    ox, oy = min(opp, key=lambda p: math.hypot(sx - p[0], sy - p[1]))
    v1 = (ox - sx, oy - sy)
    v2 = (basket[0] - sx, basket[1] - sy)
    n1 = math.hypot(*v1) or 1e-6
    n2 = math.hypot(*v2) or 1e-6
    cosang = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    def_angle = math.degrees(math.acos(cosang))

    # shooter kinematics just before release
    pre = moments[max(0, idx - 6):idx + 1]
    speed = 0.0
    closing = 0.0
    if len(pre) >= 2:
        p0 = next((e for e in pre[0][5] if e[1] == shooter), None)
        if p0 is not None:
            dt = max(pre[0][2] - rel[2], 1e-3)
            dx, dy = sx - float(p0[2]), sy - float(p0[3])
            speed = math.hypot(dx, dy) / dt
            d_then = math.hypot(float(p0[2]) - basket[0], float(p0[3]) - basket[1])
            d_now = math.hypot(sx - basket[0], sy - basket[1])
            closing = (d_then - d_now) / dt      # >0 = driving at the rim

    # time holding the ball before release
    hold = 0.0
    for m in reversed(moments[:idx + 1]):
        b, pl = _entities(m)
        p = next((e for e in pl if e[1] == shooter), None)
        if b is None or p is None:
            break
        if math.hypot(float(p[2]) - float(b[2]), float(p[3]) - float(b[3])) < HAS_BALL_DIST \
                and float(b[4]) < 10.0:
            hold = abs(m[2] - rel[2])
        else:
            break

    shot_clock = rel[3] if rel[3] is not None else np.nan

    # ---- post-release: the ball's flight (THE OUTCOME — leakage only) ------
    post = moments[idx + 1:]
    apex = bz
    min_rim3d = 99.0            # 3-D distance to the rim centre (x, y, 10 ft)
    min_rim_xy = 99.0
    z_at_rim = np.nan
    entry_angle = np.nan
    flight = 0.0
    prev = None
    for m in post:
        b, _ = _entities(m)
        if b is None:
            continue
        x, y, z = float(b[2]), float(b[3]), float(b[4])
        apex = max(apex, z)
        rim_xy = math.hypot(x - basket[0], y - basket[1])
        rim_3d = math.sqrt(rim_xy ** 2 + (z - RIM_HEIGHT) ** 2)
        if rim_3d < min_rim3d:
            min_rim3d = rim_3d
            min_rim_xy = rim_xy
            z_at_rim = z
            if prev is not None:
                dz = z - prev[2]
                dxy = math.hypot(x - prev[0], y - prev[1]) or 1e-6
                entry_angle = math.degrees(math.atan2(-dz, dxy))
        flight = abs(m[2] - rel[2])
        prev = (x, y, z)
    # did the ball pass down through the hoop cylinder? (this IS the outcome)
    through = int(min_rim_xy <= 0.9 and z_at_rim == z_at_rim and z_at_rim <= 10.5)

    return {
        "GAME_ID": int(shot["GAME_ID"]), "GAME_EVENT_ID": int(shot["GAME_EVENT_ID"]),
        "PLAYER_ID": shooter, "PERIOD": period,
        "ACTION_TYPE": shot["ACTION_TYPE"], "SHOT_TYPE": shot["SHOT_TYPE"],
        "SHOT_ZONE_BASIC": shot["SHOT_ZONE_BASIC"],
        "SHOT_DISTANCE": float(shot["SHOT_DISTANCE"]),
        "MADE": int(shot["SHOT_MADE_FLAG"]),
        # ---- legitimate (pre-release) ----
        "pre_def_dist": d1,
        "pre_def_dist_2": d2,
        "pre_def_angle": def_angle,
        "pre_help_defenders": help_n,
        "pre_shooter_speed": speed,
        "pre_closing_speed": closing,
        "pre_shot_clock": float(shot_clock) if shot_clock == shot_clock else np.nan,
        "pre_time_with_ball": hold,
        "pre_release_height": bz,
        # ---- leakage-only (post-release ball flight) ----
        "post_apex_height": apex,
        "post_entry_angle": entry_angle,
        "post_min_rim_dist": min_rim3d,
        "post_min_rim_dist_xy": min_rim_xy,
        "post_z_at_rim": z_at_rim,
        "post_through_hoop": through,
        "post_flight_time": flight,
    }


# The 7z files are named by matchup, not game id — the id is inside the JSON.
# Each worker therefore loads the shot table once and resolves the game after
# decompressing.
_SHOTS_BY_GAME: dict | None = None


def _init_worker():
    global _SHOTS_BY_GAME
    shots = load_shot_events(get_config())
    _SHOTS_BY_GAME = {int(g): d for g, d in shots.groupby("GAME_ID")}


def _process_game(fp: str) -> pd.DataFrame:
    rows = []
    with tempfile.TemporaryDirectory() as td:
        game = read_game_json(Path(fp), td)
        if game is None:
            return pd.DataFrame()
        try:
            gid = int(str(game.get("gameid", "")).lstrip("0") or 0)
        except ValueError:
            return pd.DataFrame()
        shots_for_game = (_SHOTS_BY_GAME or {}).get(gid)
        if shots_for_game is None:
            return pd.DataFrame()
        for _, shot in shots_for_game.iterrows():
            try:
                r = _shot_features(game, shot)
            except Exception:  # one bad shot must not kill the game
                r = None
            if r:
                rows.append(r)
    return pd.DataFrame(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=20, help="0 = all games")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    cfg = get_config()
    files = game_files(cfg)
    if args.games:
        files = files[: args.games]
    tasks = [str(fp) for fp in files]
    n_candidates = len(load_shot_events(cfg))
    print(f"extracting {len(tasks)} games with {args.workers} workers "
          f"({n_candidates:,} shots in the alignment table)")

    out, done, t0 = [], 0, time.time()
    with ProcessPoolExecutor(max_workers=args.workers,
                             initializer=_init_worker) as ex:
        futs = [ex.submit(_process_game, t) for t in tasks]
        for f in as_completed(futs):
            df = f.result()
            done += 1
            if len(df):
                out.append(df)
            if done % 10 == 0 or done == len(tasks):
                el = time.time() - t0
                rate = el / max(done, 1)
                print(f"  {done}/{len(tasks)} games | "
                      f"{sum(len(d) for d in out):,} shots | "
                      f"{el/60:.1f} min elapsed, "
                      f"~{rate*(len(tasks)-done)/60:.0f} min left", flush=True)

    if not out:
        print("  no shots extracted")
        return 1
    df = pd.concat(out, ignore_index=True)
    fp = cfg.path("data_movement") / "shots_tracking.parquet"
    df.to_parquet(fp, index=False)
    print(f"\n  wrote {len(df):,} shots -> {fp}")
    print(f"  make rate {df['MADE'].mean():.3f} | "
          f"median closest defender {df['pre_def_dist'].median():.1f} ft | "
          f"median shot clock {df['pre_shot_clock'].median():.1f}s | "
          f"median release height {df['pre_release_height'].median():.1f} ft")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
