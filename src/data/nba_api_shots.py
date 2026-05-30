"""Pull shots for seasons the local corpus does not cover, via the NBA Stats API.

The local `NBA_Shots_04_25` corpus ends at 2024-25 and the play-by-play at
2022-23. `shotchartdetail` serves every shot for a team-season, so 30 calls per
season reconstructs the spine for 2023-24, 2024-25 and 2025-26.

Coordinate mapping (validated, see `--validate`): the API returns LOC_X / LOC_Y in
**tenths of a foot measured from the basket**; the local corpus stores **feet from
the baseline**, so:

    loc_x = LOC_X / 10
    loc_y = LOC_Y / 10 + BASKET_FROM_BASELINE (5.25 ft)

`--validate` pulls a season we already own (2022-23) and compares the API result
against the local corpus row-for-row on the shared keys. Do not trust the mapping
without running it.

CLI:
    python -m src.data.nba_api_shots --validate            # check against 2022-23
    python -m src.data.nba_api_shots --seasons 2023-24 2024-25 2025-26
Output: data/raw/shots_api_{season}.parquet
"""
from __future__ import annotations
import argparse
import sqlite3
import time
import warnings

import numpy as np
import pandas as pd

from src.config import get_config

BASKET_FROM_BASELINE = 5.25
SLEEP = 0.7          # be polite to the NBA API
RETRIES = 4


def _teams() -> list[int]:
    from nba_api.stats.static import teams as static_teams
    return [t["id"] for t in static_teams.get_teams()]


def _position_group(cfg) -> dict[int, tuple[str, str]]:
    """PLAYER_ID -> (POSITION_GROUP, POSITION) from common_player_info."""
    con = sqlite3.connect(str(cfg.raw_path("sqlite")))
    try:
        p = pd.read_sql("select person_id, position from common_player_info", con)
    finally:
        con.close()
    out = {}
    for pid, pos in zip(p["person_id"], p["position"]):
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            continue
        pos = str(pos or "").strip()
        grp = pos[0].upper() if pos[:1].upper() in ("G", "F", "C") else "F"
        out[pid] = (grp, pos or "Forward")
    return out


def _game_meta(season: str) -> pd.DataFrame:
    """GAME_ID -> home/away tricode + date, from the league game log."""
    from nba_api.stats.endpoints import leaguegamelog
    gl = leaguegamelog.LeagueGameLog(
        season=season, season_type_all_star="Regular Season").get_data_frames()[0]
    # MATCHUP is "GSW vs. POR" (home) or "GSW @ POR" (away)
    home = gl[gl["MATCHUP"].str.contains(" vs. ")].copy()
    home["HOME_TEAM"] = home["MATCHUP"].str.split(" vs. ").str[0]
    home["AWAY_TEAM"] = home["MATCHUP"].str.split(" vs. ").str[1]
    meta = home[["GAME_ID", "GAME_DATE", "HOME_TEAM", "AWAY_TEAM"]].drop_duplicates("GAME_ID")
    return meta


def _fetch_team(team_id: int, season: str) -> pd.DataFrame:
    from nba_api.stats.endpoints import shotchartdetail
    for attempt in range(RETRIES):
        try:
            return shotchartdetail.ShotChartDetail(
                team_id=team_id, player_id=0, season_nullable=season,
                season_type_all_star="Regular Season",
                context_measure_simple="FGA").get_data_frames()[0]
        except Exception as e:  # noqa: BLE001
            warnings.warn(f"{season}/{team_id} retry {attempt + 1}: {e}")
            time.sleep(2 + 2 * attempt)
    return pd.DataFrame()


def pull_season(season: str, cfg) -> pd.DataFrame:
    """All shots for one season, normalised to the local spine schema."""
    meta = _game_meta(season)
    time.sleep(SLEEP)
    pos = _position_group(cfg)

    frames = []
    for i, tid in enumerate(_teams(), 1):
        df = _fetch_team(tid, season)
        if len(df):
            frames.append(df)
        print(f"  {season} team {i}/30: {len(df):,} shots", flush=True)
        time.sleep(SLEEP)
    if not frames:
        return pd.DataFrame()
    raw = pd.concat(frames, ignore_index=True)

    # Build on raw's index. Assigning a scalar into an EMPTY frame would create a
    # zero-row column, and the next assignment would then leave it all-NaN.
    out = pd.DataFrame(index=raw.index)
    out["SEASON"] = season
    out["TEAM_ID"] = raw["TEAM_ID"].astype("int64")
    out["TEAM_NAME"] = raw["TEAM_NAME"].astype("string")
    out["PLAYER_ID"] = raw["PLAYER_ID"].astype("int64")
    out["PLAYER_NAME"] = raw["PLAYER_NAME"].astype("string")
    grp = out["PLAYER_ID"].map(lambda p: pos.get(int(p), ("F", "Forward")))
    out["POSITION_GROUP"] = [g[0] for g in grp]
    out["POSITION"] = [g[1] for g in grp]
    out["GAME_ID"] = pd.to_numeric(raw["GAME_ID"], errors="coerce").astype("int64")
    out["EVENT_TYPE"] = raw["EVENT_TYPE"].astype("string")
    out["SHOT_MADE"] = raw["SHOT_MADE_FLAG"].astype("int8")
    out["ACTION_TYPE"] = raw["ACTION_TYPE"].astype("string")
    out["SHOT_TYPE"] = raw["SHOT_TYPE"].astype("string")
    out["BASIC_ZONE"] = raw["SHOT_ZONE_BASIC"].astype("string")
    out["ZONE_NAME"] = raw["SHOT_ZONE_AREA"].astype("string")
    out["ZONE_RANGE"] = raw["SHOT_ZONE_RANGE"].astype("string")
    # tenths of a foot from the basket -> feet, with the baseline offset.
    # The local corpus MIRRORS the API's x-axis (validated: mean loc_x +0.188 local
    # vs -0.188 api). Without this negation the left and right corners swap.
    out["LOC_X"] = -raw["LOC_X"].astype("float32") / 10.0
    out["LOC_Y"] = raw["LOC_Y"].astype("float32") / 10.0 + BASKET_FROM_BASELINE
    out["SHOT_DISTANCE"] = raw["SHOT_DISTANCE"].astype("float32")
    out["QUARTER"] = raw["PERIOD"].astype("int16")
    out["MINS_LEFT"] = raw["MINUTES_REMAINING"].astype("int16")
    out["SECS_LEFT"] = raw["SECONDS_REMAINING"].astype("int16")

    gid = pd.to_numeric(meta["GAME_ID"], errors="coerce").astype("int64")
    meta = meta.assign(GAME_ID=gid)
    out = out.merge(meta, on="GAME_ID", how="left")
    out["SHOT_ID"] = np.arange(len(out))
    return out


def validate(cfg, season: str = "2022-23") -> int:
    """Pull a season we already own and compare against the local corpus."""
    local = pd.read_parquet(cfg.path("data_raw") / "shots_tierA.parquet")
    local = local[local["SEASON"] == season]
    if not len(local):
        print(f"  local corpus has no {season}; cannot validate")
        return 1
    api = pull_season(season, cfg)
    print(f"\n  local {len(local):,} shots | api {len(api):,} shots "
          f"({len(api)/len(local):.1%})")

    def _cmp(name, a, b):
        print(f"  {name:22} local {a:8.3f}   api {b:8.3f}   diff {b-a:+.3f}")

    _cmp("make rate", local["SHOT_MADE"].mean(), api["SHOT_MADE"].mean())
    _cmp("mean shot_distance", local["SHOT_DISTANCE"].mean(), api["SHOT_DISTANCE"].mean())
    _cmp("mean loc_x", local["LOC_X"].mean(), api["LOC_X"].mean())
    _cmp("mean loc_y", local["LOC_Y"].mean(), api["LOC_Y"].mean())
    _cmp("median loc_y", local["LOC_Y"].median(), api["LOC_Y"].median())

    # the geometry identity: hypot(loc_x, loc_y - 5.25) == shot_distance
    for tag, d in (("local", local), ("api", api)):
        r = np.hypot(d["LOC_X"], d["LOC_Y"] - BASKET_FROM_BASELINE)
        err = float(np.nanmean(np.abs(r - d["SHOT_DISTANCE"])))
        print(f"  {tag:5} |hypot(loc) - shot_distance| mean error = {err:.3f} ft")

    same_zone = sorted(set(api["BASIC_ZONE"].dropna())) == sorted(set(local["BASIC_ZONE"].dropna()))
    print(f"  zone vocabulary identical: {same_zone}")

    # the x-axis sign is the one thing that can silently mirror the court:
    # the left corner must sit on the same side in both sources.
    for zone in ("Left Corner 3", "Right Corner 3"):
        a = float(local.loc[local["BASIC_ZONE"] == zone, "LOC_X"].mean())
        b = float(api.loc[api["BASIC_ZONE"] == zone, "LOC_X"].mean())
        ok = "OK" if np.sign(a) == np.sign(b) else "MIRRORED!"
        print(f"  {zone:16} local loc_x {a:+7.2f}   api {b:+7.2f}   {ok}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", nargs="*", default=[])
    ap.add_argument("--validate", action="store_true")
    args = ap.parse_args()
    cfg = get_config()

    if args.validate:
        return validate(cfg)

    for season in args.seasons:
        fp = cfg.path("data_raw") / f"shots_api_{season}.parquet"
        if fp.exists():
            print(f"{season}: cached ({len(pd.read_parquet(fp)):,} shots)")
            continue
        print(f"pulling {season} ...")
        df = pull_season(season, cfg)
        if len(df):
            df.to_parquet(fp, index=False)
            print(f"  wrote {len(df):,} shots -> {fp.name} "
                  f"(make rate {df['SHOT_MADE'].mean():.3f})")
        else:
            print(f"  {season}: no data returned")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
