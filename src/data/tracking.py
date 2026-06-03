"""Pull player tracking summaries from the NBA Stats API (leaguedashptstats) and
consolidate into one (PLAYER_ID, SEASON, tendencies) table. These are real,
publicly available aggregated tracking measurements (speed, drives, catch-and-
shoot rate, pull-up rate, paint touches). Rate-limited, cached, graceful.
"""
from __future__ import annotations
import time
import warnings

import pandas as pd

from src.config import get_config

# measure type -> tendency columns we keep
MEASURES = {
    "Drives": ["DRIVES", "DRIVE_FG_PCT", "DRIVE_PTS"],
    "CatchShoot": ["CATCH_SHOOT_FGA", "CATCH_SHOOT_FG_PCT", "CATCH_SHOOT_PTS"],
    "PullUpShot": ["PULL_UP_FGA", "PULL_UP_FG_PCT", "PULL_UP_PTS"],
    "SpeedDistance": ["AVG_SPEED", "DIST_MILES"],
    "Possessions": ["TOUCHES", "TIME_OF_POSS"],
    "PaintTouch": ["PAINT_TOUCHES", "PAINT_TOUCH_FG_PCT"],
}
SLEEP = 0.7
RETRIES = 3


def _fetch(season: str, measure: str) -> pd.DataFrame | None:
    from nba_api.stats.endpoints import leaguedashptstats
    for attempt in range(1, RETRIES + 1):
        try:
            ep = leaguedashptstats.LeagueDashPtStats(
                season=season, season_type_all_star="Regular Season",
                per_mode_simple="PerGame", player_or_team="Player",
                pt_measure_type=measure, last_n_games=0, month=0,
                opponent_team_id=0, timeout=45)
            return ep.get_data_frames()[0]
        except Exception as e:  # noqa: BLE001
            wait = SLEEP * 2 ** attempt
            warnings.warn(f"{season}/{measure} retry {attempt}: {e}")
            time.sleep(wait)
    return None


def pull_tracking(cfg=None) -> pd.DataFrame:
    """Pull all measure types for the in-scope seasons; return consolidated table.
    Returns an empty frame if the API is unreachable (pipeline then imputes)."""
    cfg = cfg or get_config()
    seasons = list(cfg.data.seasons_train) + [cfg.data.season_val, cfg.data.season_test]
    per_season = []
    for s in seasons:
        merged = None
        for measure, cols in MEASURES.items():
            df = _fetch(s, measure)
            time.sleep(SLEEP)
            if df is None:
                continue
            keep = ["PLAYER_ID"] + [c for c in cols if c in df.columns]
            sub = df[keep].copy()
            merged = sub if merged is None else merged.merge(sub, on="PLAYER_ID", how="outer")
        if merged is not None:
            merged.insert(1, "SEASON", s)
            per_season.append(merged)
            print(f"  {s}: {len(merged)} players, {merged.shape[1]-2} tendencies")
    if not per_season:
        warnings.warn("tracking pull returned nothing — features will be imputed")
        return pd.DataFrame()
    out = pd.concat(per_season, ignore_index=True)
    out.columns = [c if c in ("PLAYER_ID", "SEASON") else f"trk_{c.lower()}"
                   for c in out.columns]
    return out


def _cached_seasons(fp) -> set[str]:
    if not fp.exists():
        return set()
    try:
        return set(pd.read_parquet(fp, columns=["SEASON"])["SEASON"].unique())
    except Exception:
        return set()


def main(force: bool = False) -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true",
                    help="re-pull even if the cache already covers the window")
    force = force or ap.parse_args().force

    cfg = get_config()
    fp = cfg.path("data_raw") / "tracking_summary.parquet"
    want = set(list(cfg.data.seasons_train) + [cfg.data.season_val, cfg.data.season_test])
    have = _cached_seasons(fp)
    if have >= want and not force:
        print(f"  tracking_summary.parquet already covers all {len(want)} "
              "configured seasons (use --force to re-pull)")
        return 0
    if have:
        print(f"  cache has {len(have)} seasons, config wants {len(want)} "
              f"-> pulling (missing: {sorted(want - have)})")
    out = pull_tracking(cfg)
    if len(out):
        out.to_parquet(fp, index=False)
        print(f"  wrote {len(out)} player-seasons across "
              f"{out['SEASON'].nunique()} seasons -> {fp.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
