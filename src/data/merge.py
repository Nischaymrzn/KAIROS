"""Merge the cleaned spine with enrichment into one shot-level table.

Tier A: the cleaned spine is the merged table (self-contained).
Tier B: left-join real player profiles (SQLite, on PLAYER_ID) and tracking
        tendencies (NBA API, on PLAYER_ID + SEASON). Missing rows are imputed
        and flagged downstream.

CLI:  python -m src.data.merge
"""
from __future__ import annotations

import pandas as pd

from src.config import get_config
from src.data.clean import clean_shots


def _merge_profiles(df: pd.DataFrame, cfg) -> pd.DataFrame:
    from src.data.profiles import load_profiles
    prof = load_profiles(cfg)
    before = df["PLAYER_ID"].nunique()
    df = df.merge(prof, on="PLAYER_ID", how="left")
    cov = df["prof_height_in"].notna().mean()
    print(f"  Tier B profiles: {len(prof)} players, "
          f"{cov:.0%} of shots have a real profile ({before} shot players)")
    return df


def _merge_tracking(df: pd.DataFrame, cfg) -> pd.DataFrame:
    fp = cfg.path("data_raw") / "tracking_summary.parquet"
    if not fp.exists():
        print("  Tier B tracking: tracking_summary.parquet not found -> imputed")
        return df
    trk = pd.read_parquet(fp)
    df = df.merge(trk, on=["PLAYER_ID", "SEASON"], how="left")
    cov = df["trk_drives"].notna().mean() if "trk_drives" in df else 0
    print(f"  Tier B tracking: {len(trk)} player-seasons, "
          f"{cov:.0%} of shots have real tracking")
    return df


def _enrich_context(df: pd.DataFrame, cfg) -> pd.DataFrame:
    """Attach real score margin / home flag and possession context (play-by-play),
    plus opponent / rhythm / rest features.

    An enrichment that is *enabled in config* but then throws is a BUG, not a
    graceful degradation: it silently trains the model without the feature while
    the log says "skipped". (This happened: a dtype change from the API-sourced
    play-by-play made the shot clock vanish, and the run reported success.)
    Failures therefore re-raise unless `data.enrich_strict: false`.
    """
    strict = getattr(cfg.data, "enrich_strict", True)

    def _fail(name: str, e: Exception):
        if strict:
            raise RuntimeError(
                f"enrichment '{name}' is enabled but failed: {e}. "
                f"Set data.enrich_strict: false to allow silent degradation."
            ) from e
        print(f"  enrich {name} skipped: {e}")
    if getattr(cfg.data, "enrich_score_margin", False):
        try:
            from src.data.pbp_score import attach_score_context
            df, st = attach_score_context(df, cfg)
            print(f"  enrich score/home: margin {st['score_margin_coverage']:.0%}"
                  f", home {st['is_home_coverage']:.0%}")
        except Exception as e:
            _fail("score/home", e)
    if getattr(cfg.data, "enrich_opponent", False):
        try:
            from src.data.opponent import attach_opponent
            df, st = attach_opponent(df, cfg)
            print(f"  enrich opponent: {st['opponent_coverage']:.0%} matched")
        except Exception as e:
            _fail("opponent", e)
    if getattr(cfg.data, "enrich_possession", False):
        try:
            from src.data.pbp_context import attach_possession_context
            df, st = attach_possession_context(df, cfg)
            print(f"  enrich possession: {st['poss_coverage']:.0%} matched, "
                  f"transition {st['transition_rate']:.0%}, "
                  f"median shot-clock {st['median_shot_clock']:.0f}s")
        except Exception as e:
            _fail("possession", e)
    if getattr(cfg.data, "enrich_rhythm", False):
        try:
            from src.data.rhythm import attach_rhythm
            df, st = attach_rhythm(df, cfg)
            print(f"  enrich rhythm: prior FG known for "
                  f"{st['prior_fg_known']:.0%} of shots")
        except Exception as e:
            _fail("rhythm", e)
    if getattr(cfg.data, "enrich_rest", False):
        try:
            from src.data.rest import attach_rest
            df, st = attach_rest(df, cfg)
            print(f"  enrich rest: {st['rest_coverage']:.0%} matched, "
                  f"b2b {st['b2b_rate']:.0%}")
        except Exception as e:
            _fail("rest", e)
    return df


def build_merged(cfg=None) -> pd.DataFrame:
    cfg = cfg or get_config()
    raw_fp = cfg.path("data_raw") / "shots_tierA.parquet"
    if not raw_fp.exists():
        raise FileNotFoundError(f"{raw_fp} missing — run src.data.acquire first")
    df = clean_shots(pd.read_parquet(raw_fp))

    if "B" in cfg.data.tier.upper():
        df = _merge_profiles(df, cfg)
        df = _merge_tracking(df, cfg)
        df = _enrich_context(df, cfg)

    from src.data.contest import attach_real_contest
    df = attach_real_contest(df, cfg)

    out = cfg.path("data_interim") / "shots_merged.parquet"
    df.to_parquet(out, index=False)
    print(f"  wrote {len(df):,} merged shots ({df.shape[1]} cols) -> {out.name}")

    assert df["MADE"].isin([0, 1]).all(), "MADE not binary"
    assert not df.duplicated(subset=["SHOT_ID"]).any()
    print("  ACCEPT: binary target, unique shot rows.")
    return df


if __name__ == "__main__":
    build_merged()
