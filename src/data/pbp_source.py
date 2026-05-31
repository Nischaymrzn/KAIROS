"""One interface over both play-by-play sources.

The local SQLite `play_by_play` table covers 1996-97 → **2022-23** (and is missing
2012-13, plus individual games — verified: game 0022200005 is absent entirely).
Seasons from 2023-24 onward come from the NBA API via `src.data.nba_api_pbp`,
normalised to the same column contract.

The API pull was validated against SQLite on shared 2022-23 games: made 909/909,
missed 1111/1111, rebounds 1234/1234, turnovers 346/346, free throws 541/541,
period starts 45/45 — exact.

Column contract (what `pbp_score` and `pbp_context` consume):
    game_id (10-char str), eventnum, period, pctimestring,
    scoremargin (str, home - visitor), eventmsgtype, player1_team_id
"""
from __future__ import annotations
import sqlite3

import pandas as pd

from src.config import get_config

SQLITE_LAST_SEASON = "2022-23"   # local table stops here
_REG_PREFIX = "002"

COLUMNS = ["game_id", "eventnum", "period", "pctimestring",
           "scoremargin", "eventmsgtype", "player1_team_id"]


def window_seasons(cfg) -> list[str]:
    return list(cfg.data.seasons_train) + [cfg.data.season_val, cfg.data.season_test]


def _has_api(cfg, season: str) -> bool:
    return (cfg.path("data_raw") / f"pbp_api_{season}.parquet").exists()


def _api_seasons(cfg, seasons) -> list[str]:
    """Prefer the API wherever a cached pull exists — not just past the SQLite cutoff.

    **Why this rule changed (2026-08-06).** The routing used to be purely
    `season > SQLITE_LAST_SEASON`, which silently left the *training* seasons on the
    incomplete local table while validation and test ran on clean API data. Measured
    shot-clock coverage under the old rule:

        train 2021-22  90.30%   (SQLite)
        train 2022-23  89.76%   (SQLite)
        train 2023-24  99.78%   (API)
        val   2024-25  99.75%   (API)
        test  2025-26  99.77%   (API)

    That is a train/serve mismatch on the model's single most valuable feature
    (possession context, +0.0232 val AUC). Worse than missing rows: the incomplete
    table *distorts* the relationship — make rate across the shot clock reads
    0.431 → 0.563 on SQLite versus 0.429 → 0.675 on the API. Fixing exactly this for
    the newer seasons produced the project's largest ever gain (v5 → v6, +0.024).

    So: if a validated API pull exists for a season, use it, regardless of whether
    SQLite also covers it. SQLite remains the fallback for anything not pulled.
    """
    return [s for s in seasons if s > SQLITE_LAST_SEASON or _has_api(cfg, s)]


def _sqlite_seasons(cfg, seasons) -> list[str]:
    api = set(_api_seasons(cfg, seasons))
    return [s for s in seasons if s <= SQLITE_LAST_SEASON and s not in api]


def _yy_sql(seasons) -> str:
    yy = sorted({s[2:4] for s in seasons})
    return "(" + ",".join(f"'{y}'" for y in yy) + ")"


def _from_sqlite(cfg, seasons) -> pd.DataFrame:
    if not seasons:
        return pd.DataFrame(columns=COLUMNS)
    con = sqlite3.connect(str(cfg.raw_path("sqlite")))
    try:
        q = (
            "SELECT game_id, eventnum, period, pctimestring, scoremargin, "
            "eventmsgtype, player1_team_id FROM play_by_play "
            f"WHERE substr(game_id,1,3)='{_REG_PREFIX}' "
            f"AND substr(game_id,4,2) IN {_yy_sql(seasons)}"
        )
        df = pd.read_sql(q, con)
    finally:
        con.close()
    return df


def _from_api(cfg, seasons) -> pd.DataFrame:
    frames = []
    for s in seasons:
        fp = cfg.path("data_raw") / f"pbp_api_{s}.parquet"
        if fp.exists():
            frames.append(pd.read_parquet(fp))
        else:
            print(f"  (pbp_api_{s}.parquet missing — run src.data.nba_api_pbp)")
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=COLUMNS)


def load_pbp(cfg=None) -> pd.DataFrame:
    """Play-by-play events for the configured modelling window, from whichever
    source covers each season."""
    cfg = cfg or get_config()
    seasons = window_seasons(cfg)
    sq = _from_sqlite(cfg, _sqlite_seasons(cfg, seasons))
    ap = _from_api(cfg, _api_seasons(cfg, seasons))
    df = pd.concat([sq[COLUMNS], ap[COLUMNS]], ignore_index=True) if len(ap) else sq[COLUMNS]

    # The API parquet carries pandas *nullable* dtypes (Int64/string). Mixed with
    # SQLite's numpy dtypes they propagate pd.NA into comparisons, which then blow
    # up as "boolean value of NA is ambiguous" / "cannot convert NA to integer"
    # deep inside the possession logic. Pin the contract to plain numpy dtypes.
    df = df.copy()
    df["game_id"] = df["game_id"].astype(str).str.zfill(10)
    for c in ("period", "eventnum", "eventmsgtype", "player1_team_id"):
        df[c] = pd.to_numeric(df[c], errors="coerce").astype("float64")
    df["pctimestring"] = df["pctimestring"].astype(object)
    df["scoremargin"] = df["scoremargin"].astype(object)
    return df.dropna(subset=["period"]).reset_index(drop=True)


def main() -> int:
    cfg = get_config()
    seasons = window_seasons(cfg)
    print(f"window: {seasons}")
    print(f"  sqlite seasons: {_sqlite_seasons(cfg, seasons)}")
    print(f"  api seasons   : {_api_seasons(cfg, seasons)}")
    df = load_pbp(cfg)
    print(f"  loaded {len(df):,} events across {df['game_id'].nunique():,} games")
    yy = df["game_id"].str.slice(3, 5)
    print("  events per season-year:")
    for k, v in yy.value_counts().sort_index().items():
        print(f"    20{k}: {v:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
