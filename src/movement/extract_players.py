"""Per-shot player SET at the release frame (2015-16 SportVU) — the input the
Set-Transformer needs and that `extract_shots.py` throws away.

`shots_tracking.parquet` keeps only aggregates (closest defender, 2nd-closest,
angle, help count). A permutation-invariant model over the *defenders themselves*
needs the raw set. This module reuses `extract_shots._find_release` (so it anchors
on the identical physical release frame) and emits, per shot, the set of the up-to-9
other players in a **shooter-centred, rim-aligned frame** so the geometry is
invariant to where on the court the shot happened:

  per player: [along, perp, dist, angle_deg, is_defender, v_along, v_perp]
    along     ft toward the basket along the shot line (+ = rim side)
    perp      ft perpendicular to the shot line (signed L/R)
    dist      ft to the shooter
    angle_deg angle of the player off the shooter->rim line (0 = in the line)
    is_defender 1 = opponent, 0 = teammate
    v_along,v_perp  velocity in the same frame (ft/s, clipped to +/-SPEED_CAP)

Aligned to `shots_tracking.parquet` by (GAME_ID, GAME_EVENT_ID). Output:
  data/movement/shots_players.npz : feat (N,K,F) float32, mask (N,K) int8, keys.

CLI:
    python -m src.movement.extract_players --games 20            # pilot
    python -m src.movement.extract_players --games 0 --workers 5 # all
"""
from __future__ import annotations
import argparse
import json
import math
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

from src.config import get_config
from src.movement.extract import (BALL_TEAM, game_files, load_shot_events,
                                  read_game_json)
from src.movement.extract_shots import _entities, _find_release, _nearest_basket

K_PLAYERS = 9          # up to 9 non-shooter players on court
N_FEAT = 7
SPEED_CAP = 40.0       # ft/s — clip frame-dt division blow-ups (see TRACKING_EDA)
VEL_LOOKBACK = 4       # frames before release used to estimate each player's velocity
FEATURE_NAMES = ["along", "perp", "dist", "angle_deg", "is_defender",
                 "v_along", "v_perp"]


def _player_set(game: dict, shot) -> tuple | None:
    """Return (feat (K,F) float32, mask (K,) int8, game_id, game_event_id, made,
    shooter) for one shot, or None if it cannot be aligned."""
    period = int(shot["PERIOD"])
    st = float(shot["SHOT_TIME"])
    shooter = int(shot["PLAYER_ID"])
    found = _find_release(game, period, st, shooter)
    if found is None:
        return None
    moments, idx = found
    rel = moments[idx]
    _, players = _entities(rel)
    s = next((e for e in players if e[1] == shooter), None)
    if s is None or len(players) < 6:
        return None

    sx, sy = float(s[2]), float(s[3])
    steam = s[0]
    bx, by = _nearest_basket(sx, sy)
    ux, uy = bx - sx, by - sy
    un = math.hypot(ux, uy) or 1e-6
    ux, uy = ux / un, uy / un        # unit shooter->rim
    wx, wy = -uy, ux                 # perpendicular (left of the shot line)

    # each other player's velocity from a few frames earlier (matched by id)
    prev_pos: dict[int, tuple] = {}
    prev_clock = None
    for m in moments[max(0, idx - VEL_LOOKBACK):idx]:
        for e in m[5]:
            if e[0] != BALL_TEAM and e[1] != shooter:
                prev_pos.setdefault(int(e[1]), (float(e[2]), float(e[3]), m[2]))
        prev_clock = m[2]
    _ = prev_clock

    rows = []
    for e in players:
        if e[0] == BALL_TEAM or e[1] == shooter:
            continue
        px, py = float(e[2]), float(e[3])
        rx, ry = px - sx, py - sy
        along = rx * ux + ry * uy
        perp = rx * wx + ry * wy
        dist = math.hypot(rx, ry)
        ang = math.degrees(math.acos(max(-1.0, min(1.0, (rx * ux + ry * uy) / (dist or 1e-6)))))
        is_def = 1.0 if e[0] != steam else 0.0
        v_along = v_perp = 0.0
        pp = prev_pos.get(int(e[1]))
        if pp is not None:
            dt = abs(rel[2] - pp[2])
            if dt > 1e-2:
                vx, vy = (px - pp[0]) / dt, (py - pp[1]) / dt
                v_along = max(-SPEED_CAP, min(SPEED_CAP, vx * ux + vy * uy))
                v_perp = max(-SPEED_CAP, min(SPEED_CAP, vx * wx + vy * wy))
        rows.append([along, perp, dist, ang, is_def, v_along, v_perp])

    if not rows:
        return None
    # defenders first, then nearest — deterministic order (the model is set-based,
    # but a stable order keeps the padding/masking unambiguous)
    rows.sort(key=lambda r: (-r[4], r[2]))
    rows = rows[:K_PLAYERS]
    feat = np.zeros((K_PLAYERS, N_FEAT), dtype="float32")
    mask = np.zeros((K_PLAYERS,), dtype="int8")
    for i, r in enumerate(rows):
        feat[i] = r
        mask[i] = 1
    return (feat, mask, int(shot["GAME_ID"]), int(shot["GAME_EVENT_ID"]),
            int(shot["SHOT_MADE_FLAG"]), shooter)


_SHOTS_BY_GAME: dict | None = None


def _init_worker():
    global _SHOTS_BY_GAME
    shots = load_shot_events(get_config())
    _SHOTS_BY_GAME = {int(g): d for g, d in shots.groupby("GAME_ID")}


def _process_game(fp: str):
    feats, masks, keys = [], [], []
    with tempfile.TemporaryDirectory() as td:
        game = read_game_json(Path(fp), td)
        if game is None:
            return feats, masks, keys
        try:
            gid = int(str(game.get("gameid", "")).lstrip("0") or 0)
        except ValueError:
            return feats, masks, keys
        shots_for_game = (_SHOTS_BY_GAME or {}).get(gid)
        if shots_for_game is None:
            return feats, masks, keys
        for _, shot in shots_for_game.iterrows():
            try:
                r = _player_set(game, shot)
            except Exception:
                r = None
            if r:
                feat, mask, g, ev, made, pid = r
                feats.append(feat); masks.append(mask)
                keys.append((g, ev, made, pid))
    return feats, masks, keys


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
    print(f"extracting player sets for {len(tasks)} games, {args.workers} workers")

    feats, masks, keys, done, t0 = [], [], [], 0, time.time()
    with ProcessPoolExecutor(max_workers=args.workers, initializer=_init_worker) as ex:
        futs = [ex.submit(_process_game, t) for t in tasks]
        for f in as_completed(futs):
            fe, ma, ke = f.result()
            feats += fe; masks += ma; keys += ke
            done += 1
            if done % 20 == 0 or done == len(tasks):
                el = time.time() - t0
                print(f"  {done}/{len(tasks)} games | {len(feats):,} shots | "
                      f"{el/60:.1f} min | ~{el/max(done,1)*(len(tasks)-done)/60:.0f} min left",
                      flush=True)

    if not feats:
        print("  no shots extracted")
        return 1
    feat = np.stack(feats)
    mask = np.stack(masks)
    keys = np.asarray(keys, dtype="int64")
    fp = cfg.path("data_movement") / "shots_players.npz"
    np.savez(fp, feat=feat, mask=mask,
             game_id=keys[:, 0], game_event_id=keys[:, 1],
             made=keys[:, 2], player_id=keys[:, 3],
             feature_names=np.asarray(FEATURE_NAMES))
    (cfg.path("data_movement") / "players_manifest.json").write_text(json.dumps({
        "n_shots": int(len(feat)), "K_players": K_PLAYERS, "n_feat": N_FEAT,
        "features": FEATURE_NAMES, "speed_cap": SPEED_CAP,
        "games": len(tasks), "make_rate": float(keys[:, 2].mean()),
        "mean_players_per_shot": float(mask.sum(1).mean())}, indent=2))
    print(f"\n  wrote {len(feat):,} shots -> {fp.name}  "
          f"(shape {feat.shape}, mean players/shot {mask.sum(1).mean():.1f}, "
          f"make rate {keys[:,2].mean():.3f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
