"""Precompute full ten-player replay clips from the raw 2015-16 SportVU logs.

WHY PRECOMPUTE
Each game is a 104 MB JSON inside a 6 MB archive, holding about 450 events at
25 Hz. Decompressing and parsing that per request is not serving, it is a batch
job with an HTTP interface. This writes one small clip per play instead, which
the API then hands over as a file read.

WHAT A CLIP IS
One shot, with every player and the ball for the seconds leading into it:

    frames[i] = [gameClock, shotClock, ballX, ballY, ballZ, p0x, p0y, ... p9x, p9y]

Positions are already converted to the court frame the client draws, so the
browser does no geometry. Frames are thinned to about 12 Hz, which is smooth to
the eye and halves the payload.

Only plays that appear in the aligned trajectory index are written, so a clip
always corresponds to a shot whose outcome is known and whose tracking agrees
with the shot record. See backend/services/replay.py for that filter.

    python scripts/build_replay_plays.py --games 6 --per-game 40
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import pandas as pd

SEVENZIP = r"C:/Program Files/7-Zip/7z.exe"
LOGS = Path("data/movement_data/NBA-Player-Movements/data/2016.NBA.Raw.SportVU.Game.Logs")
TRAJ = Path("data/movement/trajectories.parquet")
OUT = Path("data/movement/plays")

COURT_LEN, COURT_WID = 94.0, 50.0
STRIDE = 2                    # 25 Hz -> ~12.5 Hz
PRE_FRAMES = 200              # raw moments kept before the release, about 8 s


def to_court(x: float, y: float, mirror: bool) -> tuple[float, float]:
    """SportVU (x, y) to the client's half court (x, z), attacking rim at -41.75."""
    if mirror:
        x, y = COURT_LEN - x, COURT_WID - y
    return round(-COURT_LEN / 2 + x, 2), round(y - COURT_WID / 2, 2)


def aligned_index() -> pd.DataFrame:
    """Plays whose tracked release matches the recorded shot distance."""
    df = pd.read_parquet(TRAJ)
    last = df.sort_values("step").groupby(["GAME_ID", "GAME_EVENT_ID"]).tail(1)
    keep = last[(last["basket_dist"] - last["SHOT_DISTANCE"]).abs() <= 3.0]
    return keep[["GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "PERIOD", "ACTION_TYPE",
                 "SHOT_MADE_FLAG", "SHOT_DISTANCE", "x", "y"]]


def read_game(archive: Path) -> dict:
    out = subprocess.run([SEVENZIP, "e", "-so", str(archive)],
                         capture_output=True, check=True)
    return json.loads(out.stdout)


def build(games: int, per_game: int) -> None:
    idx = aligned_index()
    by_game = {int(g): d for g, d in idx.groupby("GAME_ID")}
    OUT.mkdir(parents=True, exist_ok=True)

    archives = sorted(LOGS.glob("*.7z"))
    written = 0
    manifest: list[dict] = []

    for arc in archives:
        if len({m["gameId"] for m in manifest}) >= games:
            break
        try:
            game = read_game(arc)
        except Exception as e:                      # noqa: BLE001
            print(f"  skip {arc.name}: {e}")
            continue

        gid = int(game["gameid"])
        wanted = by_game.get(gid)
        if wanted is None:
            continue
        want_events = {int(r.GAME_EVENT_ID): r for r in wanted.itertuples()}
        print(f"{arc.name}  game {gid}  {len(want_events)} candidate plays")

        made_here = 0
        for ev in game["events"]:
            if made_here >= per_game:
                break
            eid = int(ev.get("eventId", -1))
            rec = want_events.get(eid)
            if rec is None or not ev.get("moments"):
                continue

            # ANCHOR THE CLIP TO THE RELEASE.
            #
            # An event is not a shot: it is a whole dead-ball-to-dead-ball
            # sequence, and the shot can sit anywhere inside it. Taking the last
            # N moments therefore produced clips that ended wherever the event
            # happened to stop, which for one Nowitzki jumper left the shooter 73
            # ft from the rim on a recorded 25 ft shot.
            #
            # The trajectory index carries the shooter's SportVU position at
            # release, so the release frame is the moment where he is nearest to
            # it. The clip is the window ending there.
            rel_x, rel_y = float(rec.x), float(rec.y)
            shooter_id = int(rec.PLAYER_ID)
            best_i, best_d = None, 1e9
            for i, m in enumerate(ev["moments"]):
                ents = m[5] if len(m) > 5 else None
                if not ents:
                    continue
                for e in ents:
                    if int(e[1]) == shooter_id:
                        d = (float(e[2]) - rel_x) ** 2 + (float(e[3]) - rel_y) ** 2
                        if d < best_d:
                            best_d, best_i = d, i
                        break
            # More than a couple of feet out means this event does not contain
            # the shot the index says it does.
            if best_i is None or best_d > 4.0:
                continue

            lo = max(0, best_i - PRE_FRAMES)
            moments = ev["moments"][lo:best_i + 1][::STRIDE]
            if len(moments) < 20:
                continue

            # Roster in a fixed order so a frame is a flat array of coordinates.
            home, away = ev["home"], ev["visitor"]
            roster = [(p["playerid"], p["jersey"],
                       f'{p["firstname"]} {p["lastname"]}', "home") for p in home["players"]]
            roster += [(p["playerid"], p["jersey"],
                        f'{p["firstname"]} {p["lastname"]}', "away") for p in away["players"]]
            slot = {pid: i for i, (pid, *_) in enumerate(roster)}

            # Which basket is attacked: whichever the shooter is nearer at
            # release. The halfway line gets fast breaks wrong.
            mirror = bool((rel_x - 88.75) ** 2 < (rel_x - 5.25) ** 2)

            frames, on_court = [], []
            for m in moments:
                ents = m[5]
                if not ents:
                    continue
                ball = next((e for e in ents if e[0] == -1), None)
                if ball is None:
                    continue
                bx, bz = to_court(float(ball[2]), float(ball[3]), mirror)
                row = [round(float(m[2] or 0), 1), round(float(m[3] or 0), 1),
                       bx, bz, round(float(ball[4]), 2)]

                players = [e for e in ents if e[0] != -1]
                if len(players) != 10:
                    continue
                if not on_court:
                    on_court = [int(p[1]) for p in players]
                coords = {int(p[1]): to_court(float(p[2]), float(p[3]), mirror) for p in players}
                ok = True
                for pid in on_court:
                    c = coords.get(pid)
                    if c is None:
                        ok = False
                        break
                    row.extend(c)
                if ok:
                    frames.append(row)

            if len(frames) < 20 or not on_court:
                continue

            lineup = []
            for pid in on_court:
                i = slot.get(pid)
                if i is None:
                    lineup.append({"id": pid, "jersey": "?", "name": "unknown", "side": "home"})
                else:
                    pid2, jersey, name, side = roster[i]
                    lineup.append({"id": pid2, "jersey": jersey, "name": name, "side": side})

            clip = {
                "gameId": gid,
                "eventId": eid,
                "date": game.get("gamedate"),
                "home": {"abbr": home["abbreviation"], "name": home["name"]},
                "away": {"abbr": away["abbreviation"], "name": away["name"]},
                "period": int(rec.PERIOD),
                "action": str(rec.ACTION_TYPE),
                "distance": int(rec.SHOT_DISTANCE),
                "made": bool(rec.SHOT_MADE_FLAG),
                "shooterId": int(rec.PLAYER_ID),
                "lineup": lineup,
                "frames": frames,
            }
            (OUT / f"{gid}-{eid}.json").write_text(json.dumps(clip, separators=(",", ":")))
            manifest.append({
                "gameId": gid, "eventId": eid, "date": clip["date"],
                "home": clip["home"]["abbr"], "away": clip["away"]["abbr"],
                "period": clip["period"], "action": clip["action"],
                "distance": clip["distance"], "made": clip["made"],
                "shooterId": clip["shooterId"], "frames": len(frames),
            })
            made_here += 1
            written += 1

        print(f"  wrote {made_here}")

    (OUT / "manifest.json").write_text(json.dumps({"plays": manifest}, indent=1))
    size = sum(f.stat().st_size for f in OUT.glob("*.json")) / 1e6
    print(f"\n{written} clips, {size:.1f} MB in {OUT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=6)
    ap.add_argument("--per-game", type=int, default=40)
    build(**vars(ap.parse_args()))
