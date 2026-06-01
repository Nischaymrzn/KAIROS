"""Opponent / team-context enrichment from the local box-score totals.

For each shot we attach the **defending team's season-to-date profile**, computed
from PRIOR games only (no future leakage):
  * `opp_def_rating` — points allowed per game so far this season (a defensive
    strength proxy; lower = tougher defence).
  * `opp_pace`       — possessions per game so far (FGA − OREB + TOV + 0.44·FTA).

The box-score `totals` files are one row per (team, game). points_allowed is
recovered as `PTS − PLUS_MINUS`. Season-to-date means use an expanding mean
shifted by one game (the current game is excluded), so a value only ever depends
on games already played.

CLI:  python -m src.data.opponent      # coverage self-test on the spine
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import get_config

_TOTALS = ["regular_season_totals_2010_2024.csv", "play_off_totals_2010_2024.csv"]
_USE = ["SEASON_YEAR", "TEAM_ID", "GAME_ID", "GAME_DATE",
        "PTS", "PLUS_MINUS", "FGA", "FTA", "OREB", "TOV"]


def _load_totals(cfg) -> pd.DataFrame:
    base = cfg.raw_path("box_scores_dir")
    frames = []
    for name in _TOTALS:
        fp = base / name
        if fp.exists():
            frames.append(pd.read_csv(fp, usecols=lambda c: c in _USE))
    if not frames:
        return pd.DataFrame(columns=_USE)
    df = pd.concat(frames, ignore_index=True)
    df["GAME_ID"] = pd.to_numeric(df["GAME_ID"], errors="coerce").astype("Int64")
    df["TEAM_ID"] = pd.to_numeric(df["TEAM_ID"], errors="coerce").astype("Int64")
    df["GAME_DATE"] = pd.to_datetime(df["GAME_DATE"], errors="coerce")
    return df.dropna(subset=["GAME_ID", "TEAM_ID", "GAME_DATE"])


def _season_to_date(df: pd.DataFrame) -> pd.DataFrame:
    """Add prior-games-only opp_def_rating & opp_pace per (team, game)."""
    df = df.copy()
    df["pts_allowed"] = df["PTS"] - df["PLUS_MINUS"]
    df["poss"] = df["FGA"] - df["OREB"] + df["TOV"] + 0.44 * df["FTA"]
    df = df.sort_values(["TEAM_ID", "SEASON_YEAR", "GAME_DATE"])
    g = df.groupby(["TEAM_ID", "SEASON_YEAR"], observed=True)
    # expanding mean of games strictly before the current one (shift, no current)
    df["opp_def_rating"] = g["pts_allowed"].transform(lambda s: s.shift().expanding().mean())
    df["opp_pace"] = g["poss"].transform(lambda s: s.shift().expanding().mean())
    return df[["GAME_ID", "TEAM_ID", "opp_def_rating", "opp_pace"]]


def attach_opponent(shots: pd.DataFrame, cfg=None) -> tuple[pd.DataFrame, dict]:
    """Add OPP_DEF_RATING and OPP_PACE (the defending team's season-to-date
    profile) to a shot frame. Unmatched rows keep NaN for downstream flagging."""
    cfg = cfg or get_config()
    df = shots.copy()
    totals = _load_totals(cfg)
    if totals.empty:
        df["OPP_DEF_RATING"] = np.nan
        df["OPP_PACE"] = np.nan
        return df, {"opponent_coverage": 0.0, "reason": "no box-score totals found"}

    std = _season_to_date(totals)

    # the two team ids that played each game -> defending team = the other one
    pair = (totals[["GAME_ID", "TEAM_ID"]].dropna().drop_duplicates()
            .groupby("GAME_ID")["TEAM_ID"].apply(list))
    gid = df["GAME_ID"].astype("int64")

    def _defender(row_gid: int, shooter: int):
        teams = pair.get(row_gid)
        if not teams or len(teams) != 2:
            return np.nan
        return teams[1] if int(teams[0]) == shooter else teams[0]

    defend = [
        _defender(int(g), int(t))
        for g, t in zip(gid.to_numpy(), df["TEAM_ID"].astype("int64").to_numpy())
    ]
    join = pd.DataFrame({"GAME_ID": gid.to_numpy(),
                         "TEAM_ID": pd.array(defend, dtype="Int64")})
    join = join.merge(std, on=["GAME_ID", "TEAM_ID"], how="left")

    df["OPP_DEF_RATING"] = join["opp_def_rating"].to_numpy(dtype="float32", na_value=np.nan)
    df["OPP_PACE"] = join["opp_pace"].to_numpy(dtype="float32", na_value=np.nan)
    stats = {"opponent_coverage": float(np.isfinite(df["OPP_DEF_RATING"]).mean()),
             "n_shots": int(len(df))}
    return df, stats


def main() -> int:
    cfg = get_config()
    shots = pd.read_parquet(cfg.path("data_raw") / "shots_tierA.parquet")
    df, stats = attach_opponent(shots, cfg)
    print(f"opponent context match: {stats['opponent_coverage']:.1%} "
          f"| n={stats.get('n_shots', 0):,}")
    ok = df["OPP_DEF_RATING"].replace([np.inf, -np.inf], np.nan).dropna()
    if len(ok):
        print(f"opp_def_rating range [{ok.min():.1f}, {ok.max():.1f}], "
              f"mean {ok.mean():.1f}; opp_pace mean "
              f"{df['OPP_PACE'].replace([np.inf,-np.inf],np.nan).dropna().mean():.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
