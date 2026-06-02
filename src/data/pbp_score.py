"""Score-margin & home enrichment from the local SQLite play-by-play.

The NBA_Shots spine has no score state. The SQLite `play_by_play` table
(~13.6M rows) covers season-years 2018-19 → 2022-23 — exactly the core window —
so we can recover the running **score margin at each shot** and a reliable
**home/away** flag, joining on (GAME_ID, running game clock).

Join method (leakage-safe: score margin *before* the shot is a legitimate
game-state feature, not an outcome):
  * PBP `scoremargin` is populated only on scoring rows; forward-fill it within
    each game (ordered by eventnum) so every event carries the current margin
    (home − visitor). A game starts 0-0.
  * Convert each PBP row and each shot to a single **game-elapsed second** across
    all periods, then `merge_asof(direction="backward")` per game: each shot
    takes the margin of the most recent event at or before it.
  * Orient to the shooter: `+` = shooter's team leading. Home is decided by the
    shooter team's abbreviation vs the spine's HOME_TEAM.

CLI:  python -m src.data.pbp_score       # coverage self-test on the spine
"""
from __future__ import annotations
import sqlite3

import numpy as np
import pandas as pd

from src.config import get_config

_REG_PREFIX = "002"


def scope_yy(cfg) -> tuple[str, ...]:
    """Season-year prefixes (game_id chars 4-5) for the configured window.
    '2013-14' -> '13'. Derived from config so widening the window widens the
    play-by-play scan automatically."""
    seasons = list(cfg.data.seasons_train) + [cfg.data.season_val, cfg.data.season_test]
    return tuple(sorted({s[2:4] for s in seasons}))


def _yy_sql(cfg) -> str:
    """SQL tuple literal, safe for a single-element scope."""
    return "(" + ",".join(f"'{y}'" for y in scope_yy(cfg)) + ")"
PERIOD_LEN = 720          # regulation quarter, seconds
OT_LEN = 300              # overtime period, seconds


def _team_abbrev_map(cfg) -> dict[int, str]:
    con = sqlite3.connect(str(cfg.raw_path("sqlite")))
    try:
        t = pd.read_sql("SELECT id, abbreviation FROM team", con)
    finally:
        con.close()
    return {int(i): str(a) for i, a in zip(t["id"], t["abbreviation"])}


def _parse_margin(s: pd.Series) -> pd.Series:
    """PBP scoremargin -> signed int (home − visitor); 'TIE' -> 0, blanks -> NaN."""
    s = s.astype("string").str.strip()
    s = s.replace({"TIE": "0", "": pd.NA, "None": pd.NA})
    return pd.to_numeric(s, errors="coerce")


def _period_start_elapsed(period: pd.Series) -> pd.Series:
    """Game-elapsed seconds at the start of each period (1-based)."""
    p = period.to_numpy()
    reg = np.minimum(p - 1, 4) * PERIOD_LEN
    ot = np.maximum(p - 5, 0) * OT_LEN
    return pd.Series(reg + ot, index=period.index)


def _clock_to_elapsed(period: pd.Series, remaining_sec: pd.Series) -> pd.Series:
    """(period, seconds-remaining-in-period) -> game-elapsed seconds."""
    length = np.where(period.to_numpy() <= 4, PERIOD_LEN, OT_LEN)
    return _period_start_elapsed(period) + (length - remaining_sec.to_numpy())


def _load_pbp_margin(cfg) -> pd.DataFrame:
    """One row per PBP event: game_id(str), game_elapsed, margin_home (ffilled).

    Source-agnostic: SQLite for seasons up to 2022-23, NBA API beyond (see
    `src.data.pbp_source`)."""
    from src.data.pbp_source import load_pbp
    pbp = load_pbp(cfg)
    pbp = pbp[pbp["pctimestring"].notna()].copy()
    mm = pbp["pctimestring"].astype("string").str.split(":", expand=True)
    remaining = pd.to_numeric(mm[0], errors="coerce") * 60 + pd.to_numeric(mm[1], errors="coerce")
    pbp = pbp[remaining.notna() & pbp["period"].notna()].copy()
    pbp["period"] = pbp["period"].astype(int)
    pbp["game_elapsed"] = _clock_to_elapsed(pbp["period"], remaining.loc[pbp.index]).astype(float)

    # forward-fill margin within each game (ordered by eventnum); game starts 0-0
    pbp["margin_home"] = _parse_margin(pbp["scoremargin"])
    pbp = pbp.sort_values(["game_id", "eventnum"])
    pbp["margin_home"] = pbp.groupby("game_id")["margin_home"].ffill().fillna(0.0)
    return pbp[["game_id", "game_elapsed", "margin_home"]].reset_index(drop=True)


def attach_score_context(shots: pd.DataFrame, cfg=None) -> tuple[pd.DataFrame, dict]:
    """Add SCORE_MARGIN (shooter perspective) and IS_HOME to a shot frame.

    Returns (frame_with_columns, stats). Rows with no PBP match keep NaN so the
    feature layer can flag them imputed.
    """
    cfg = cfg or get_config()
    df = shots.copy()

    # Reliable home flag from the team abbreviation vs the spine's HOME_TEAM.
    # Compare as nullable strings and resolve NA explicitly: an unknown team or a
    # missing HOME_TEAM means "not known to be home", not a crash.
    abbr = _team_abbrev_map(cfg)
    team_abbr = df["TEAM_ID"].astype("int64").map(abbr).astype("string")
    home_tri = df["HOME_TEAM"].astype("string")
    df["IS_HOME"] = (team_abbr == home_tri).fillna(False).astype("int8")
    home_known = float((team_abbr.notna() & home_tri.notna()).mean())

    # game-elapsed second for each shot
    gid = df["GAME_ID"].astype("int64").astype(str).str.zfill(10)
    shot_remaining = df["MINS_LEFT"].astype(float) * 60 + df["SECS_LEFT"].astype(float)
    elapsed = _clock_to_elapsed(df["QUARTER"].astype(int), shot_remaining)

    left = pd.DataFrame({"_i": np.arange(len(df)), "game_id": gid.values,
                         "game_elapsed": elapsed.values})
    pbp = _load_pbp_margin(cfg)
    left = left.sort_values("game_elapsed")
    pbp = pbp.sort_values("game_elapsed")
    # allow_exact_matches=False: take the margin from the most recent event
    # STRICTLY before the shot — never the shot's own same-second scoring event
    # (which would leak the outcome into the margin).
    merged = pd.merge_asof(left, pbp, on="game_elapsed", by="game_id",
                           direction="backward", allow_exact_matches=False)
    merged = merged.sort_values("_i")

    margin_home = merged["margin_home"].to_numpy()               # home − visitor
    is_home = df["IS_HOME"].to_numpy()
    df["SCORE_MARGIN"] = np.where(is_home == 1, margin_home, -margin_home)
    df["SCORE_MARGIN"] = pd.to_numeric(df["SCORE_MARGIN"], errors="coerce").astype("float32")

    stats = {
        "score_margin_coverage": float(np.isfinite(df["SCORE_MARGIN"]).mean()),
        "is_home_coverage": home_known,
        "n_shots": int(len(df)),
    }
    return df, stats


def main() -> int:
    cfg = get_config()
    raw = cfg.path("data_raw") / "shots_tierA.parquet"
    shots = pd.read_parquet(raw)
    df, stats = attach_score_context(shots, cfg)
    print(f"score-margin match: {stats['score_margin_coverage']:.1%} "
          f"| home known: {stats['is_home_coverage']:.1%} "
          f"| n={stats['n_shots']:,}")
    ok = df["SCORE_MARGIN"].dropna()
    print(f"margin range [{ok.min():.0f}, {ok.max():.0f}], mean {ok.mean():.2f}, "
          f"home shots {df['IS_HOME'].mean():.1%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
