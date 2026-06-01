"""Attach real pre-shot contest measurements where they exist.

Per-shot defender distance is public for two seasons only, in two different
shapes, and neither carries a key that joins directly to the shot corpus:

  2014-15  shot_logs.csv          CLOSE_DEF_DIST, DRIBBLES, TOUCH_TIME
  2015-16  shots_tracking.parquet pre_def_dist and the rest of the SportVU set

Both are recovered by reconstructing a join key and then *verifying* it against
the make/miss outcome, which the two sides record independently. A key that
were wrong would agree with the outcome at the base rate (~47%); the checks
below hold it to a floor far above that, and rows that disagree are dropped
rather than trusted.

Everything here produces `real_*` columns that are NaN outside the two covered
seasons. The feature layer decides what to do with that; this module only
supplies measurements.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import get_config

# a correct join agrees with the independently recorded outcome almost always;
# below this the key is wrong and the merge is refused rather than silently used
MIN_OUTCOME_AGREEMENT = 0.90


def _shot_ordinal(df: pd.DataFrame) -> pd.Series:
    """The player's Nth shot within a game, matching shot_logs' SHOT_NUMBER."""
    elapsed = -(df["MINS_LEFT"].astype("float64") * 60 + df["SECS_LEFT"].astype("float64"))
    order = df.assign(_q=df["QUARTER"].astype("int16"), _t=elapsed).sort_values(
        ["GAME_ID", "PLAYER_ID", "_q", "_t"], kind="mergesort")
    return (order.groupby(["GAME_ID", "PLAYER_ID"], sort=False).cumcount() + 1
            ).reindex(df.index)


def _verify(matched: pd.DataFrame, their_made: str, label: str) -> pd.DataFrame:
    """Keep only rows where both sources agree on the outcome."""
    agree = matched["MADE"].astype(int) == matched[their_made].astype(int)
    rate = float(agree.mean()) if len(matched) else 0.0
    if rate < MIN_OUTCOME_AGREEMENT:
        raise ValueError(
            f"{label}: join agrees with the recorded outcome only {rate:.1%} "
            f"of the time — the key is wrong, refusing to merge")
    print(f"    {label}: {len(matched):,} matched, {rate:.1%} outcome agreement, "
          f"keeping {int(agree.sum()):,}")
    return matched[agree]


def _from_shot_logs(shots: pd.DataFrame, cfg) -> pd.DataFrame:
    """2014-15 shot logs, joined on (game, player, shot ordinal)."""
    fp = cfg.raw_path("shot_logs_2014_15")
    if not fp.exists():
        print(f"    shot logs absent ({fp.name}) — 2014-15 contest stays imputed")
        return pd.DataFrame()

    logs = pd.read_csv(fp).rename(columns={"player_id": "PLAYER_ID"})
    logs = logs[["GAME_ID", "PLAYER_ID", "SHOT_NUMBER", "CLOSE_DEF_DIST",
                 "DRIBBLES", "TOUCH_TIME", "FGM"]].drop_duplicates(
        ["GAME_ID", "PLAYER_ID", "SHOT_NUMBER"])

    season = shots[shots["SEASON"] == "2014-15"].copy()
    if season.empty:
        return pd.DataFrame()
    season["SHOT_NUMBER"] = _shot_ordinal(season)

    m = season.merge(logs, on=["GAME_ID", "PLAYER_ID", "SHOT_NUMBER"], how="inner")
    m = _verify(m, "FGM", "2014-15 shot logs")
    return pd.DataFrame({
        "SHOT_ID": m["SHOT_ID"].values,
        "real_def_dist": m["CLOSE_DEF_DIST"].astype("float32").values,
        "real_dribbles": m["DRIBBLES"].astype("float32").values,
        "real_touch_time": m["TOUCH_TIME"].astype("float32").values,
    })


def _from_sportvu(shots: pd.DataFrame, cfg) -> pd.DataFrame:
    """2015-16 SportVU, joined on (game, player, period, rounded distance)."""
    fp = cfg.path("data_movement") / "shots_tracking.parquet"
    if not fp.exists():
        print(f"    tracking absent ({fp.name}) — 2015-16 contest stays imputed")
        return pd.DataFrame()

    trk = pd.read_parquet(fp)
    trk["k_dist"] = trk["SHOT_DISTANCE"].round().astype("int16")
    cols = ["GAME_ID", "PLAYER_ID", "PERIOD", "k_dist"]
    # a player taking two shots from the same distance in one period is ambiguous;
    # drop those rather than attach the wrong defender to the wrong shot
    trk = trk.drop_duplicates(cols, keep=False)

    season = shots[shots["SEASON"] == "2015-16"].copy()
    if season.empty:
        return pd.DataFrame()
    season["PERIOD"] = season["QUARTER"].astype("int16")
    season["k_dist"] = season["SHOT_DISTANCE"].round().astype("int16")
    season = season.drop_duplicates(cols, keep=False)

    keep = cols + ["pre_def_dist", "pre_def_angle", "pre_help_defenders",
                   "pre_shooter_speed", "pre_time_with_ball", "MADE"]
    m = season.merge(trk[keep].rename(columns={"MADE": "trk_made"}),
                     on=cols, how="inner")
    m = _verify(m, "trk_made", "2015-16 SportVU")
    return pd.DataFrame({
        "SHOT_ID": m["SHOT_ID"].values,
        "real_def_dist": m["pre_def_dist"].astype("float32").values,
        "real_def_angle": m["pre_def_angle"].astype("float32").values,
        "real_help_defenders": m["pre_help_defenders"].astype("float32").values,
        "real_shooter_speed": m["pre_shooter_speed"].astype("float32").values,
        "real_touch_time": m["pre_time_with_ball"].astype("float32").values,
    })


REAL_COLS = ["real_def_dist", "real_dribbles", "real_touch_time",
             "real_def_angle", "real_help_defenders", "real_shooter_speed"]


def attach_real_contest(df: pd.DataFrame, cfg=None) -> pd.DataFrame:
    """Add `real_*` contest columns, NaN where no measurement exists."""
    cfg = cfg or get_config()
    print("  real contest measurements:")
    parts = [p for p in (_from_shot_logs(df, cfg), _from_sportvu(df, cfg)) if len(p)]

    for c in REAL_COLS:
        df[c] = np.float32(np.nan)
    if not parts:
        print("    none available — every season stays imputed")
        return df

    real = pd.concat(parts, ignore_index=True).drop_duplicates("SHOT_ID", keep="first")
    real = real.set_index("SHOT_ID")
    idx = df["SHOT_ID"]
    for c in REAL_COLS:
        if c in real.columns:
            df[c] = real[c].reindex(idx).to_numpy(dtype="float32")

    cov = df["real_def_dist"].notna()
    by_season = df.loc[cov, "SEASON"].value_counts().sort_index()
    print(f"    total {int(cov.sum()):,} shots with real defender distance "
          f"({cov.mean():.1%} of corpus)")
    for s, n in by_season.items():
        print(f"      {s}: {n:,}")
    return df
