"""Possession context from the local play-by-play — recovering the shot clock.

Per-shot shot clock is not published for 2018-23. But the play-by-play *is*, and
it carries every possession-changing event. By reconstructing possession
boundaries we recover, for the core window:

  * seconds since the possession started
  * a **shot-clock proxy** (24s base, 14s after an offensive rebound)
  * whether the shot came in **transition** (early in a possession that began
    with a rebound or a turnover)
  * the type of the event immediately preceding the shot, and how long ago

Every value depends only on events that happened **strictly before** the shot, so
none of it can encode the outcome. The join reuses the `merge_asof` pattern from
`pbp_score.py` with `allow_exact_matches=False`, which is what keeps the shot's
own scoring event out of the window.

NBA event codes: 1 made shot, 2 missed shot, 3 free throw, 4 rebound,
5 turnover, 6 foul, 7 violation, 8 substitution, 9 timeout, 12 period begin.

CLI:  python -m src.data.pbp_context      # coverage + sanity self-test
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import get_config
from src.data.pbp_score import _clock_to_elapsed

# events that start a new possession (or reset the clock). Free throws are
# included because a trip to the line ends the possession; ffill then picks the
# LAST free throw of the trip, which is the true restart.
MADE_SHOT, MISSED_SHOT, FREE_THROW = 1, 2, 3
REBOUND, TURNOVER, PERIOD_BEGIN = 4, 5, 12
RESET_EVENTS = (MADE_SHOT, FREE_THROW, REBOUND, TURNOVER, PERIOD_BEGIN)

SHOT_CLOCK_FULL = 24.0     # change of possession
SHOT_CLOCK_OREB = 14.0     # offensive rebound reset (2018-19 onward, see below)
TRANSITION_SECS = 7.0      # "early in the possession"

# The 14-second reset after an offensive rebound was introduced for the 2018-19
# season. Before that an offensive rebound reset the clock to a full 24s. Applying
# the modern rule to older seasons understates their shot clock by 10s on ~12% of
# shots, so the base is chosen per season.
OREB_14_FIRST_SEASON = 2018


def _season_start_year(season: pd.Series) -> np.ndarray:
    """'2013-14' -> 2013."""
    return pd.to_numeric(season.astype("string").str.slice(0, 4),
                         errors="coerce").to_numpy()


def _load_pbp_events(cfg) -> pd.DataFrame:
    """PBP events with game-elapsed seconds and the possession start they belong
    to (forward-filled from the last reset event within each game)."""
    from src.data.pbp_source import load_pbp
    pbp = load_pbp(cfg)
    pbp = pbp[pbp["pctimestring"].notna() & pbp["period"].notna()].copy()
    mm = pbp["pctimestring"].astype("string").str.split(":", expand=True)
    remaining = (pd.to_numeric(mm[0], errors="coerce") * 60
                 + pd.to_numeric(mm[1], errors="coerce"))
    pbp = pbp[remaining.notna()].copy()
    pbp["period"] = pbp["period"].astype(int)
    pbp["game_elapsed"] = _clock_to_elapsed(pbp["period"],
                                            remaining.loc[pbp.index]).astype(float)
    pbp = pbp.sort_values(["game_id", "eventnum"])

    # An OFFENSIVE rebound is one taken by the team that just MISSED (14s reset).
    # A defensive rebound is also taken by the team that shoots next, so comparing
    # the rebounding team to the *shooter's* team cannot distinguish them — we must
    # compare it to the team of the preceding missed shot.
    miss_team = pbp["player1_team_id"].where(pbp["eventmsgtype"] == MISSED_SHOT)
    miss_team = pbp.assign(_m=miss_team).groupby("game_id")["_m"].ffill()
    is_oreb_event = ((pbp["eventmsgtype"] == REBOUND)
                     & pbp["player1_team_id"].notna()
                     & (pbp["player1_team_id"] == miss_team))

    is_reset = pbp["eventmsgtype"].isin(RESET_EVENTS)
    pbp["_is_oreb"] = is_oreb_event
    # the elapsed time / type / oreb-flag of the reset event that opened this possession
    for col, src in (("poss_start", "game_elapsed"),
                     ("poss_reset_type", "eventmsgtype"),
                     ("poss_is_oreb", "_is_oreb")):
        pbp[col] = pbp[src].where(is_reset)
        pbp[col] = pbp.groupby("game_id")[col].ffill()

    # keep a copy of the event's own time: merge_asof consumes `game_elapsed`
    pbp["ev_elapsed"] = pbp["game_elapsed"]
    return pbp[["game_id", "game_elapsed", "ev_elapsed", "eventmsgtype",
                "poss_start", "poss_reset_type", "poss_is_oreb"]].reset_index(drop=True)


def attach_possession_context(shots: pd.DataFrame, cfg=None) -> tuple[pd.DataFrame, dict]:
    """Add possession/shot-clock context columns to a shot frame."""
    cfg = cfg or get_config()
    df = shots.copy()

    gid = df["GAME_ID"].astype("int64").astype(str).str.zfill(10)
    shot_remaining = df["MINS_LEFT"].astype(float) * 60 + df["SECS_LEFT"].astype(float)
    elapsed = _clock_to_elapsed(df["QUARTER"].astype(int), shot_remaining)

    left = pd.DataFrame({"_i": np.arange(len(df)), "game_id": gid.values,
                         "game_elapsed": elapsed.values}).sort_values("game_elapsed")
    pbp = _load_pbp_events(cfg).sort_values("game_elapsed")

    # the last event STRICTLY before the shot (never the shot's own event)
    m = pd.merge_asof(left, pbp, on="game_elapsed", by="game_id",
                      direction="backward", allow_exact_matches=False)
    m = m.sort_values("_i")

    shot_elapsed = elapsed.to_numpy()
    poss_start = m["poss_start"].to_numpy(dtype="float64")
    reset_type = m["poss_reset_type"].to_numpy(dtype="float64")
    is_oreb = m["poss_is_oreb"].eq(True).to_numpy()      # NaN -> False, no downcast
    prev_type = m["eventmsgtype"].to_numpy(dtype="float64")
    secs_since_prev = shot_elapsed - m["ev_elapsed"].to_numpy(dtype="float64")

    poss_elapsed = shot_elapsed - poss_start
    poss_elapsed = np.where(np.isfinite(poss_elapsed) & (poss_elapsed >= 0),
                            poss_elapsed, np.nan)

    # offensive rebound -> 14s reset, but only from 2018-19 (rule change);
    # earlier seasons reset to a full 24s.
    if "SEASON" in df.columns:
        oreb_14 = _season_start_year(df["SEASON"]) >= OREB_14_FIRST_SEASON
    else:
        oreb_14 = np.ones(len(df), dtype=bool)
    base = np.where(is_oreb & oreb_14, SHOT_CLOCK_OREB, SHOT_CLOCK_FULL)
    shot_clock = np.clip(base - poss_elapsed, 0.0, SHOT_CLOCK_FULL)

    # transition = early in a possession that began with a DEFENSIVE rebound or
    # a turnover (a live-ball change of possession)
    is_transition = ((poss_elapsed <= TRANSITION_SECS)
                     & np.isin(reset_type, [REBOUND, TURNOVER])
                     & ~is_oreb).astype("int8")

    df["POSS_ELAPSED"] = poss_elapsed.astype("float32")
    df["SHOT_CLOCK_PROXY"] = shot_clock.astype("float32")
    df["IS_TRANSITION"] = is_transition
    df["POSS_RESET_TYPE"] = pd.to_numeric(reset_type, errors="coerce").astype("float32")
    df["PREV_EVENT_TYPE"] = pd.to_numeric(prev_type, errors="coerce").astype("float32")
    df["SECS_SINCE_PREV_EVENT"] = np.where(
        np.isfinite(secs_since_prev) & (secs_since_prev >= 0),
        secs_since_prev, np.nan).astype("float32")

    stats = {
        "poss_coverage": float(np.isfinite(poss_elapsed).mean()),
        "transition_rate": float(is_transition.mean()),
        "median_shot_clock": float(np.nanmedian(shot_clock)),
        "n_shots": int(len(df)),
    }
    return df, stats


def main() -> int:
    cfg = get_config()
    shots = pd.read_parquet(cfg.path("data_raw") / "shots_tierA.parquet")
    df, st = attach_possession_context(shots, cfg)
    print(f"possession context: {st['poss_coverage']:.1%} matched | "
          f"transition {st['transition_rate']:.1%} of shots | "
          f"median shot-clock proxy {st['median_shot_clock']:.1f}s")

    made = (shots["EVENT_TYPE"].astype("string") == "Made Shot").astype(int).to_numpy()
    for col in ("SHOT_CLOCK_PROXY", "POSS_ELAPSED", "IS_TRANSITION"):
        v = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype="float64")
        ok = np.isfinite(v)
        c = np.corrcoef(v[ok], made[ok])[0, 1]
        print(f"  corr({col:<17}, MADE) = {c:+.4f}")

    tr = df["IS_TRANSITION"].to_numpy() == 1
    print(f"  make rate: transition {made[tr].mean():.3f} vs "
          f"half-court {made[~tr].mean():.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
