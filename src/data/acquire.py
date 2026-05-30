"""Acquire raw sources for the configured tier into data/raw/.

Tier A (required): the local NBA_Shots_04_25 corpus, filtered to the in-scope
seasons. The whole pipeline must run from Tier A alone.
Tier B (optional): player tracking summaries + profiles (local if present, else
a warning — never crash the run).
Tier C (Phase 2): movement data, registered separately.

CLI:  python -m src.data.acquire --tier A
"""
from __future__ import annotations
import argparse
import json
import warnings
import zipfile
from datetime import date
from pathlib import Path

import pandas as pd

from src.config import get_config

# Columns we keep from the NBA_Shots spine.
SHOT_COLS = [
    "SEASON_2", "TEAM_ID", "TEAM_NAME", "PLAYER_ID", "PLAYER_NAME",
    "POSITION_GROUP", "POSITION", "GAME_DATE", "GAME_ID", "HOME_TEAM",
    "AWAY_TEAM", "EVENT_TYPE", "SHOT_MADE", "ACTION_TYPE", "SHOT_TYPE",
    "BASIC_ZONE", "ZONE_NAME", "ZONE_RANGE", "LOC_X", "LOC_Y",
    "SHOT_DISTANCE", "QUARTER", "MINS_LEFT", "SECS_LEFT",
]


def season_to_endyear(season: str) -> int:
    """'2018-19' -> 2019 (the NBA_Shots file end-year)."""
    return int(season[:4]) + 1


def _read_shot_zip(fp: Path) -> pd.DataFrame:
    with zipfile.ZipFile(fp) as zf:
        inner = [n for n in zf.namelist()
                 if n.endswith(".csv") and not n.startswith("__MACOSX")]
        if not inner:
            raise ValueError(f"no CSV inside {fp}")
        with zf.open(inner[0]) as f:
            return pd.read_csv(f, usecols=SHOT_COLS)


def acquire_tier_a(cfg) -> pd.DataFrame:
    """Load the shot spine for all in-scope seasons.

    Seasons covered by the local `NBA_Shots_04_25` corpus are read from its zips.
    Seasons it does not cover (2025-26 onward) come from the NBA-API pull
    (`data/raw/shots_api_{season}.parquet`, `src.data.nba_api_shots`), which was
    validated to reproduce the local corpus exactly on 2022-23.
    """
    seasons = list(cfg.data.seasons_train) + [cfg.data.season_val, cfg.data.season_test]
    shots_dir = cfg.raw_path("nba_shots_dir")
    frames = []
    for s in seasons:
        fp = shots_dir / f"NBA_{season_to_endyear(s)}_Shots.csv.zip"
        api_fp = cfg.path("data_raw") / f"shots_api_{s}.parquet"
        df, src = None, None
        if fp.exists():
            try:
                df = _read_shot_zip(fp)
                df = df[df["SEASON_2"] == s]      # guard: only the requested season
                df = df.rename(columns={"SEASON_2": "SEASON"})
                src = "local"
            except ValueError as e:
                # the corpus schema is not stable across seasons (the 2024-25 file
                # drops POSITION_GROUP/POSITION) — fall back to the API pull
                print(f"  {s}: local zip unusable ({e.args[0][:48]}...), using API")
                df = None
        if df is None:
            if not api_fp.exists():
                raise FileNotFoundError(
                    f"no usable shots for {s}: neither {fp.name} nor {api_fp.name}. "
                    f"Run: python -m src.data.nba_api_shots --seasons {s}")
            df = pd.read_parquet(api_fp)
            src = "api"
        keep = ["SEASON"] + [c for c in SHOT_COLS if c != "SEASON_2"]
        df = df[[c for c in keep if c in df.columns]]
        frames.append(df)
        print(f"  {s}: {len(df):,} shots ({src})")
    out = pd.concat(frames, ignore_index=True)
    out.insert(0, "SHOT_ID", range(len(out)))  # NBA_Shots has no event id
    n = int(cfg.dev.sample_rows or 0)
    if n and n < len(out):
        out = out.sample(n=n, random_state=cfg.seed).reset_index(drop=True)
        print(f"  dev.sample_rows -> subsampled to {len(out):,}")
    return out


def acquire_tier_b(cfg) -> dict:
    """Report Tier-B source availability. Profiles are read live from the SQLite
    DB in the merge step; tracking is the cached NBA-API pull. Nothing here is
    required — the merge imputes and flags whatever is missing."""
    info = {}
    trk = cfg.path("data_raw") / "tracking_summary.parquet"
    if trk.exists():
        info["tracking"] = "cached"
        print("  Tier B: tracking_summary.parquet present")
    else:
        info["tracking"] = "missing"
        warnings.warn("Tier B: tracking_summary.parquet not found — run "
                      "`python -m src.data.tracking` to add it (else imputed).")
    info["profiles_db"] = cfg.raw_path("sqlite").exists()
    return info


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", default=None, help="A | AB | ABC (default: config)")
    args = ap.parse_args()
    cfg = get_config()
    tier = (args.tier or cfg.data.tier).upper()

    raw = cfg.path("data_raw")
    print(f"Acquiring tier {tier} -> {raw}")
    shots = acquire_tier_a(cfg)
    out_fp = raw / "shots_tierA.parquet"
    shots.to_parquet(out_fp, index=False)
    print(f"  wrote {len(shots):,} shots -> {out_fp.name}")

    manifest = {
        "pulled": date.today().isoformat(),
        "tier": tier,
        "rows": int(len(shots)),
        "seasons": sorted(shots["SEASON"].unique().tolist()),
        "rows_per_season": shots["SEASON"].value_counts().sort_index().to_dict(),
    }
    if "B" in tier:
        manifest["tier_b"] = acquire_tier_b(cfg)
    (raw / "_manifest.json").write_text(json.dumps(manifest, indent=2))
    print("  manifest -> _manifest.json")

    # acceptance
    assert len(shots) > 800_000, f"spine too small: {len(shots)}"
    scope = set(cfg.data.seasons_train) | {cfg.data.season_val, cfg.data.season_test}
    assert set(shots["SEASON"].unique()) <= scope, "out-of-scope season present"
    print("  ACCEPT: >800k shots, no out-of-scope season.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
