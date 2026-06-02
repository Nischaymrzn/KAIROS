"""In-game rhythm / "hot hand" features — strictly prior shots only.

For each shot we summarise what that shooter has already done **earlier in the
same game**: attempts so far, makes so far, their running FG%, and how long since
their last attempt.

Causality: every quantity is a cumulative statistic **shifted by one shot**, so a
shot never sees its own outcome. These are outcome-derived (from *other*, earlier
shots), which is legitimate and standard in the hot-hand literature — but it is
exactly the kind of feature that must be built carefully, so the shift is
asserted in `tests/test_no_leakage.py`.

CLI:  python -m src.data.rhythm      # sanity self-test
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import get_config
from src.data.pbp_score import _clock_to_elapsed


def attach_rhythm(shots: pd.DataFrame, cfg=None) -> tuple[pd.DataFrame, dict]:
    """Add PRIOR_ATTEMPTS, PRIOR_MAKES, PRIOR_FG, SECS_SINCE_LAST_SHOT."""
    df = shots.copy()
    if "MADE" not in df.columns:
        raise KeyError("attach_rhythm needs MADE (run clean_shots first)")

    remaining = df["MINS_LEFT"].astype(float) * 60 + df["SECS_LEFT"].astype(float)
    df["_elapsed"] = _clock_to_elapsed(df["QUARTER"].astype(int), remaining).astype(float)

    order = df.sort_values(["GAME_ID", "PLAYER_ID", "_elapsed"]).index
    d = df.loc[order]
    g = d.groupby(["GAME_ID", "PLAYER_ID"], sort=False)

    prior_attempts = g.cumcount()                                   # 0 for first shot
    prior_makes = g["MADE"].cumsum() - d["MADE"]                    # exclude self
    prev_elapsed = g["_elapsed"].shift(1)

    d["PRIOR_ATTEMPTS"] = prior_attempts.astype("float32")
    d["PRIOR_MAKES"] = prior_makes.astype("float32")
    with np.errstate(invalid="ignore", divide="ignore"):
        d["PRIOR_FG"] = np.where(prior_attempts > 0,
                                 prior_makes / prior_attempts.replace(0, np.nan),
                                 np.nan).astype("float32")
    d["SECS_SINCE_LAST_SHOT"] = (d["_elapsed"] - prev_elapsed).astype("float32")

    out = d.sort_index()
    df = shots.copy()
    for c in ("PRIOR_ATTEMPTS", "PRIOR_MAKES", "PRIOR_FG", "SECS_SINCE_LAST_SHOT"):
        df[c] = out[c].to_numpy()

    stats = {
        "mean_prior_attempts": float(np.nanmean(df["PRIOR_ATTEMPTS"])),
        "prior_fg_known": float(np.isfinite(df["PRIOR_FG"]).mean()),
        "n_shots": int(len(df)),
    }
    return df, stats


def main() -> int:
    from src.data.clean import clean_shots
    cfg = get_config()
    shots = clean_shots(pd.read_parquet(cfg.path("data_raw") / "shots_tierA.parquet"))
    df, st = attach_rhythm(shots, cfg)
    print(f"rhythm: mean prior attempts {st['mean_prior_attempts']:.2f} | "
          f"prior FG known for {st['prior_fg_known']:.0%} of shots")

    y = df["MADE"].to_numpy()
    for c in ("PRIOR_ATTEMPTS", "PRIOR_MAKES", "PRIOR_FG", "SECS_SINCE_LAST_SHOT"):
        v = df[c].to_numpy(dtype="float64")
        ok = np.isfinite(v)
        print(f"  corr({c:<20}, MADE) = {np.corrcoef(v[ok], y[ok])[0, 1]:+.4f}")

    # the hot-hand question, descriptively
    prev_made = df["PRIOR_MAKES"].diff().fillna(0) > 0  # crude, per-row
    hot = df[df["PRIOR_FG"] >= 0.6]
    cold = df[df["PRIOR_FG"] <= 0.2]
    print(f"  make rate when prior FG>=60%: {hot['MADE'].mean():.3f} "
          f"| when prior FG<=20%: {cold['MADE'].mean():.3f}")
    del prev_made
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
