"""Rest / fatigue features for the shooting team, from box-score game dates.

For each shot we attach how rested the shooting team was going into the game:
days since their previous game, whether it is a back-to-back, and how many games
they played in the preceding week. All are computed from **prior games only**.

CLI:  python -m src.data.rest      # coverage self-test
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import get_config
from src.data.opponent import _load_totals

MAX_REST_DAYS = 14.0   # cap long layoffs (all-star break, season start)


def _team_rest(totals: pd.DataFrame) -> pd.DataFrame:
    """Per (GAME_ID, TEAM_ID): rest days, back-to-back, games in prior 7 days."""
    df = totals[["GAME_ID", "TEAM_ID", "GAME_DATE"]].drop_duplicates().copy()
    df = df.sort_values(["TEAM_ID", "GAME_DATE"])
    g = df.groupby("TEAM_ID", sort=False)

    prev = g["GAME_DATE"].shift(1)
    df["rest_days"] = (df["GAME_DATE"] - prev).dt.days.astype("float32")
    df["is_b2b"] = (df["rest_days"] <= 1).astype("int8")

    # games played in the 7 days strictly before this game
    counts = []
    for _, grp in df.groupby("TEAM_ID", sort=False):
        dates = grp["GAME_DATE"].to_numpy()
        lo = dates - np.timedelta64(7, "D")
        # strictly-before window: count prior games with date in [lo, date)
        c = [(np.sum((dates < d) & (dates >= l))) for d, l in zip(dates, lo)]
        counts.append(pd.Series(c, index=grp.index, dtype="float32"))
    df["games_last_7"] = pd.concat(counts).sort_index()

    df["rest_days"] = df["rest_days"].clip(upper=MAX_REST_DAYS)
    return df[["GAME_ID", "TEAM_ID", "rest_days", "is_b2b", "games_last_7"]]


def attach_rest(shots: pd.DataFrame, cfg=None) -> tuple[pd.DataFrame, dict]:
    """Add REST_DAYS, IS_B2B, GAMES_LAST_7 for the shooting team."""
    cfg = cfg or get_config()
    df = shots.copy()
    totals = _load_totals(cfg)
    if totals.empty:
        for c in ("REST_DAYS", "IS_B2B", "GAMES_LAST_7"):
            df[c] = np.nan
        return df, {"rest_coverage": 0.0, "reason": "no box-score totals"}

    rest = _team_rest(totals)
    join = pd.DataFrame({"GAME_ID": df["GAME_ID"].astype("int64"),
                         "TEAM_ID": df["TEAM_ID"].astype("int64")})
    join["GAME_ID"] = join["GAME_ID"].astype("Int64")
    join["TEAM_ID"] = join["TEAM_ID"].astype("Int64")
    j = join.merge(rest, on=["GAME_ID", "TEAM_ID"], how="left")

    df["REST_DAYS"] = j["rest_days"].to_numpy(dtype="float32", na_value=np.nan)
    df["IS_B2B"] = j["is_b2b"].to_numpy(dtype="float32", na_value=np.nan)
    df["GAMES_LAST_7"] = j["games_last_7"].to_numpy(dtype="float32", na_value=np.nan)

    stats = {"rest_coverage": float(np.isfinite(df["REST_DAYS"]).mean()),
             "b2b_rate": float(np.nanmean(df["IS_B2B"])),
             "n_shots": int(len(df))}
    return df, stats


def main() -> int:
    cfg = get_config()
    shots = pd.read_parquet(cfg.path("data_raw") / "shots_tierA.parquet")
    df, st = attach_rest(shots, cfg)
    print(f"rest: {st['rest_coverage']:.1%} matched | back-to-back "
          f"{st['b2b_rate']:.1%} of shots")
    made = (shots["EVENT_TYPE"].astype("string") == "Made Shot").astype(int).to_numpy()
    for c in ("REST_DAYS", "IS_B2B", "GAMES_LAST_7"):
        v = df[c].to_numpy(dtype="float64")
        ok = np.isfinite(v)
        print(f"  corr({c:<13}, MADE) = {np.corrcoef(v[ok], made[ok])[0, 1]:+.4f}")
    b2b = df["IS_B2B"].to_numpy() == 1
    print(f"  make rate: back-to-back {made[b2b].mean():.3f} vs rested "
          f"{made[~b2b & np.isfinite(df['IS_B2B'].to_numpy())].mean():.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
