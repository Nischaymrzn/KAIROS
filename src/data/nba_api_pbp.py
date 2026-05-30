"""Pull play-by-play for seasons the local SQLite does not cover (2023-24 onward).

The local `play_by_play` table stops at 2022-23. `playbyplayv2` is deprecated and
now returns empty JSON, so we use **`playbyplayv3`** (~0.6 s/game). Roughly 1,230
games per season, so this is the one genuinely slow acquisition step.

V3 has a different shape from the SQLite table, so we normalise it back:

  * `clock` is an ISO duration, "PT11M43.00S" -> seconds remaining
  * `actionType` is a string, not an int -> mapped to the SQLite `eventmsgtype`
    codes our possession logic already understands (1 made, 2 missed, 3 free
    throw, 4 rebound, 5 turnover, 12 period begin)
  * score margin is derived from `scoreHome - scoreAway`

**Resumable:** each game is cached to `data/raw/pbp_api/{season}/{game_id}.parquet`,
so an interrupted run resumes where it stopped. Seasons are consolidated into
`data/raw/pbp_api_{season}.parquet` at the end.

CLI:
    python -m src.data.nba_api_pbp --validate 2022-23      # compare vs SQLite
    python -m src.data.nba_api_pbp --seasons 2023-24 2024-25 2025-26
"""
from __future__ import annotations
import argparse
import re
import time
import warnings

import numpy as np
import pandas as pd

from src.config import get_config

SLEEP = 0.35
RETRIES = 3

# playbyplayv3 actionType -> SQLite eventmsgtype (what pbp_context expects)
ACTION_TO_MSGTYPE = {
    "Made Shot": 1, "Missed Shot": 2, "Free Throw": 3, "Rebound": 4,
    "Turnover": 5, "Foul": 6, "Violation": 7, "Substitution": 8,
    "Timeout": 9, "Jump Ball": 10, "Ejection": 11, "period": 12,
}
_CLOCK = re.compile(r"PT(\d+)M([\d.]+)S")


def _clock_seconds(s) -> float:
    m = _CLOCK.match(str(s))
    if not m:
        return np.nan
    return int(m.group(1)) * 60 + float(m.group(2))


def season_game_ids(season: str) -> list[str]:
    from nba_api.stats.endpoints import leaguegamelog
    gl = leaguegamelog.LeagueGameLog(
        season=season, season_type_all_star="Regular Season").get_data_frames()[0]
    return sorted(gl["GAME_ID"].astype(str).unique())


def _fetch_game(game_id: str) -> pd.DataFrame:
    from nba_api.stats.endpoints import playbyplayv3
    for attempt in range(RETRIES):
        try:
            return playbyplayv3.PlayByPlayV3(game_id=game_id).get_data_frames()[0]
        except Exception as e:  # noqa: BLE001
            warnings.warn(f"{game_id} retry {attempt + 1}: {e}")
            time.sleep(1.5 + 2 * attempt)
    return pd.DataFrame()


UNKNOWN_MSGTYPE = 18   # matches the SQLite table's "unknown" code


def _normalise(raw: pd.DataFrame, game_id: str) -> pd.DataFrame:
    if not len(raw):
        return pd.DataFrame()
    # V3 emits a companion row per event for the opposing team, with a blank
    # actionType (5.1% of rows). Keep only rows whose actionType maps to a known
    # event code, then dedupe on the action number. Validated against SQLite: this
    # reproduces its event counts on shared games.
    raw = raw.copy()
    at = raw["actionType"].astype("string").str.strip()
    sub = raw["subType"].astype("string").str.strip().str.lower()
    msg = at.map(ACTION_TO_MSGTYPE)
    # "period" covers both start and end; the subType disambiguates them
    msg = msg.where(at != "period",
                    np.where(sub == "start", 12, 13))
    raw["_msg"] = pd.to_numeric(msg, errors="coerce")
    raw = raw[raw["_msg"].notna()]
    raw = raw.drop_duplicates(subset=["actionNumber"], keep="first")
    if not len(raw):
        return pd.DataFrame()
    # CRITICAL: after filtering, `raw` keeps a non-contiguous index. The frame we
    # build below starts with a fresh RangeIndex, so assigning Series into it would
    # align by index and silently drop rows. Reset first.
    raw = raw.reset_index(drop=True)

    df = pd.DataFrame()
    df["game_id"] = [str(game_id).zfill(10)] * len(raw)
    df["eventnum"] = pd.to_numeric(raw["actionNumber"], errors="coerce")
    df["period"] = pd.to_numeric(raw["period"], errors="coerce")
    secs = raw["clock"].map(_clock_seconds)
    mins = (secs // 60).astype("Int64")
    rem = (secs % 60).round().astype("Int64")
    df["pctimestring"] = mins.astype("string") + ":" + rem.astype("string").str.zfill(2)

    df["eventmsgtype"] = raw["_msg"].astype("Int64")

    home = pd.to_numeric(raw["scoreHome"], errors="coerce")
    away = pd.to_numeric(raw["scoreAway"], errors="coerce")
    margin = (home - away)
    df["scoremargin"] = margin.where(margin.notna()).astype("string")
    df["player1_team_id"] = pd.to_numeric(raw["teamId"], errors="coerce")
    return df.dropna(subset=["period"])


def pull_season(season: str, cfg, limit: int | None = None) -> pd.DataFrame:
    cache = cfg.path("data_raw") / "pbp_api" / season
    cache.mkdir(parents=True, exist_ok=True)
    gids = season_game_ids(season)
    if limit:
        gids = gids[:limit]
    time.sleep(SLEEP)

    frames, t0 = [], time.time()
    for i, gid in enumerate(gids, 1):
        fp = cache / f"{gid}.parquet"
        if fp.exists():
            frames.append(pd.read_parquet(fp))
            continue
        df = _normalise(_fetch_game(gid), gid)
        if len(df):
            df.to_parquet(fp, index=False)
            frames.append(df)
        time.sleep(SLEEP)
        if i % 50 == 0 or i == len(gids):
            el = time.time() - t0
            rate = el / i
            print(f"  {season} {i}/{len(gids)} games | {el/60:.1f} min elapsed, "
                  f"~{rate*(len(gids)-i)/60:.0f} min left", flush=True)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def validate(cfg, season: str = "2022-23", n_games: int = 12) -> int:
    """Compare the V3 pull against the SQLite table on a season we already own."""
    import sqlite3
    api = pull_season(season, cfg, limit=n_games)
    if not len(api):
        print("  no API rows")
        return 1
    gids = tuple(api["game_id"].unique())
    con = sqlite3.connect(str(cfg.raw_path("sqlite")))
    try:
        q = ("SELECT game_id, eventmsgtype, period, pctimestring, scoremargin "
             f"FROM play_by_play WHERE game_id IN ({','.join('?'*len(gids))})")
        loc = pd.read_sql(q, con, params=list(gids))
    finally:
        con.close()

    print(f"\n  {len(gids)} games | sqlite {len(loc):,} rows | api {len(api):,} rows")
    for t in (1, 2, 3, 4, 5):
        a = int((loc["eventmsgtype"] == t).sum())
        b = int((api["eventmsgtype"] == t).sum())
        name = {1: "made", 2: "missed", 3: "free throw", 4: "rebound", 5: "turnover"}[t]
        print(f"  eventmsgtype {t} ({name:11}) sqlite {a:>5}   api {b:>5}   "
              f"diff {b-a:+d}")
    lm = pd.to_numeric(loc["scoremargin"].replace("TIE", "0"), errors="coerce").abs()
    am = pd.to_numeric(api["scoremargin"], errors="coerce").abs()
    print(f"  |score margin| mean: sqlite {lm.mean():.2f}   api {am.mean():.2f}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", nargs="*", default=[])
    ap.add_argument("--validate", nargs="?", const="2022-23", default=None)
    args = ap.parse_args()
    cfg = get_config()

    if args.validate:
        return validate(cfg, args.validate)

    for season in args.seasons:
        fp = cfg.path("data_raw") / f"pbp_api_{season}.parquet"
        if fp.exists():
            print(f"{season}: cached ({len(pd.read_parquet(fp)):,} rows)")
            continue
        print(f"pulling play-by-play {season} ...", flush=True)
        df = pull_season(season, cfg)
        if len(df):
            df.to_parquet(fp, index=False)
            print(f"  wrote {len(df):,} events -> {fp.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
