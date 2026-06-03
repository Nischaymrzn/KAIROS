"""Validate every dataset: what exists, which seasons it covers, and whether it
can actually feed the model. Writes `reports/DATA_VALIDATION.md`.

This is the evidence behind the modelling-window decision. A season is only
usable for training if the spine AND every feature source that the model relies
on cover it. The binding constraint is the play-by-play (source of the shot-clock
proxy, our only enrichment that measurably helps).

CLI:  python -m src.data.validate
"""
from __future__ import annotations
import sqlite3
import zipfile
from pathlib import Path

import pandas as pd

from src.config import get_config

# tracking (leaguedashptstats) only exists from the first league-wide tracking season
TRACKING_FIRST_SEASON = "2013-14"


def _yy_to_season(yy: str) -> str:
    n = int(yy)
    full = 1900 + n if n >= 90 else 2000 + n
    return f"{full}-{str(full + 1)[2:]}"


def shot_corpus_seasons(cfg) -> dict[str, int]:
    """Season -> row count (reads only the zip header/row count cheaply)."""
    out = {}
    d = cfg.raw_path("nba_shots_dir")
    for fp in sorted(d.glob("NBA_*_Shots.csv.zip")):
        end = int(fp.stem.split("_")[1])
        season = f"{end - 1}-{str(end)[2:]}"
        try:
            with zipfile.ZipFile(fp) as zf:
                inner = [n for n in zf.namelist()
                         if n.endswith(".csv") and not n.startswith("__MACOSX")]
                with zf.open(inner[0]) as f:
                    n = sum(1 for _ in f) - 1
            out[season] = n
        except Exception:
            out[season] = -1
    return out


def pbp_sqlite_seasons(cfg) -> list[str]:
    """Seasons covered by the LOCAL SQLite play_by_play table."""
    con = sqlite3.connect(str(cfg.raw_path("sqlite")))
    try:
        q = ("SELECT DISTINCT substr(game_id,4,2) yy FROM play_by_play "
             "WHERE substr(game_id,1,3)='002'")
        yy = [r[0] for r in con.execute(q)]
    finally:
        con.close()
    return sorted(_yy_to_season(y) for y in yy)


def pbp_api_seasons(cfg) -> list[str]:
    """Seasons covered by the cached NBA-API `playbyplayv3` pulls.

    Added 2026-08-06. Without this the report claimed play-by-play was MISSING for
    2023-24 and 2024-25 and capped the usable window at 2022-23 — while the
    production model was training through 2025-26 on exactly these files. The
    check knew only about SQLite and had never been taught about the API route
    added in `src/data/pbp_source.py`.
    """
    out = []
    for fp in sorted(cfg.path("data_raw").glob("pbp_api_*.parquet")):
        season = fp.stem.replace("pbp_api_", "")
        if len(season) == 7 and season[4] == "-":
            out.append(season)
    return out


def pbp_seasons(cfg) -> list[str]:
    """Every season the pipeline can actually source play-by-play for, from either
    route — this is what `src/data/pbp_source.py` resolves at build time."""
    return sorted(set(pbp_sqlite_seasons(cfg)) | set(pbp_api_seasons(cfg)))


def box_seasons(cfg) -> list[str]:
    fp = cfg.raw_path("box_scores_dir") / "regular_season_totals_2010_2024.csv"
    if not fp.exists():
        return []
    d = pd.read_csv(fp, usecols=["SEASON_YEAR"])
    return sorted(d["SEASON_YEAR"].unique().tolist())


def tracking_seasons(cfg) -> list[str]:
    fp = cfg.path("data_raw") / "tracking_summary.parquet"
    if not fp.exists():
        return []
    return sorted(pd.read_parquet(fp)["SEASON"].unique().tolist())


def sqlite_tables(cfg) -> dict[str, int]:
    con = sqlite3.connect(str(cfg.raw_path("sqlite")))
    out = {}
    try:
        for t in ("common_player_info", "draft_combine_stats", "play_by_play", "team"):
            try:
                out[t] = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            except Exception:
                out[t] = -1
    finally:
        con.close()
    return out


def movement_games(cfg) -> int:
    root = Path(cfg.raw_path("nba_shots_dir")).parents[1]
    d = root / "movement_data" / "nba-movement-data" / "data"
    return len(list(d.glob("*.7z"))) if d.exists() else 0


def usable_window(shots: dict, pbp: list[str], box: list[str]) -> list[str]:
    """Seasons where the spine AND the play-by-play both exist, from the first
    tracking season onward, taking the longest contiguous run."""
    cand = [s for s in sorted(shots)
            if s in pbp and s >= TRACKING_FIRST_SEASON and shots[s] > 0]
    # longest contiguous run (season year increments by 1)
    best, run = [], []
    for s in cand:
        if run and int(s[:4]) != int(run[-1][:4]) + 1:
            best, run = (run if len(run) > len(best) else best), [s]
        else:
            run.append(s)
    return run if len(run) > len(best) else best


def main() -> int:
    cfg = get_config()
    shots = shot_corpus_seasons(cfg)
    sq = pbp_sqlite_seasons(cfg)
    api = pbp_api_seasons(cfg)
    pbp = pbp_seasons(cfg)
    box = box_seasons(cfg)
    trk = tracking_seasons(cfg)
    tables = sqlite_tables(cfg)
    games = movement_games(cfg)

    window = usable_window(shots, pbp, box)
    configured = list(cfg.data.seasons_train) + [cfg.data.season_val, cfg.data.season_test]

    print(f"shot corpus     : {len(shots)} seasons "
          f"({min(shots)} -> {max(shots)}), {sum(shots.values()):,} shots")
    print(f"play-by-play    : {len(pbp)} seasons ({min(pbp)} -> {max(pbp)})")
    print(f"box-score totals: {len(box)} seasons ({min(box)} -> {max(box)})" if box
          else "box-score totals: MISSING")
    print(f"tracking cached : {len(trk)} seasons {trk}")
    print(f"SportVU games   : {games} (2015-16 only)")
    print(f"sqlite tables   : {tables}")
    print()
    print(f"USABLE WINDOW (spine + PBP, tracking era): {len(window)} seasons "
          f"{window[0]} -> {window[-1]}" if window else "NO usable window")
    print(f"currently configured: {configured}")

    missing_pbp = [s for s in shots if s >= TRACKING_FIRST_SEASON and s not in pbp]
    missing_trk = [s for s in window if s not in trk]

    lines = [
        "# DATA_VALIDATION.md — every dataset, validated",
        "",
        "Generated by `python -m src.data.validate`. A season is usable for",
        "training only if the shot spine **and** the play-by-play cover it — the",
        "play-by-play is the source of the shot-clock proxy, the only enrichment",
        "that measurably improves the model: **+0.0232 val AUC** on complete",
        "play-by-play, versus only +0.0015 on the incomplete local SQLite.",
        "",
        "## Source coverage",
        "",
        "| Source | Seasons | Span | Notes |",
        "|---|---|---|---|",
        f"| Shot spine (`NBA_Shots_04_25`) | {len(shots)} | {min(shots)} → {max(shots)} | {sum(shots.values()):,} shots |",
        f"| Play-by-play (SQLite, local) | {len(sq)} | {min(sq)} → {max(sq)} | incomplete (~90% of events, whole games missing) |",
        f"| Play-by-play (NBA-API `playbyplayv3`) | {len(api)} | {min(api) if api else '-'} → {max(api) if api else '-'} | **99.8% coverage**; used beyond the SQLite span |",
        f"| Box-score totals | {len(box)} | {min(box) if box else '-'} → {max(box) if box else '-'} | opponent context (ablated out) |",
        f"| Tracking (`leaguedashptstats`) | {len(trk)} | {min(trk) if trk else '-'} → {max(trk) if trk else '-'} | NBA API, cached |",
        f"| SportVU tracking | 1 | 2015-16 | {games} game files |",
        "| 2014-15 shot logs | 1 | 2014-15 | defender study only |",
        "",
        "## Gaps found",
        "",
        f"- Play-by-play **missing** for: {', '.join(missing_pbp) or 'none'}",
        f"- Tracking summaries not yet pulled for: {', '.join(missing_trk) or 'none'}",
        "",
        "## Modelling window",
        "",
        "Longest contiguous run with spine + play-by-play, from the first",
        "league-wide tracking season (" + TRACKING_FIRST_SEASON + "):",
        "",
        f"**{window[0]} → {window[-1]} ({len(window)} seasons)**" if window else "none",
        "",
        "Play-by-play is resolved at build time by `src/data/pbp_source.py`: SQLite",
        "for the seasons it covers, the cached NBA-API `playbyplayv3` pulls beyond.",
        "(`playbyplayv2` is **deprecated and returns empty JSON** — do not use it.)",
        "",
        "**The production window is therefore not limited to the SQLite span.** v7",
        "trains on 2021-22 → 2023-24, validates on 2024-25 and tests on 2025-26,",
        "sourcing play-by-play for the last three seasons from the API. Widening the",
        "window *backwards* was measured and rejected: 10 seasons scored 0.6709 vs",
        "0.6737, and the full 12-season window 0.6957 vs 0.7001 — era drift.",
        "",
        "## Per-season shot counts",
        "",
        "| Season | Shots | PBP | Box | Tracking |",
        "|---|---|---|---|---|",
    ]
    for s in sorted(shots):
        if s < "2010-11":
            continue
        lines.append(f"| {s} | {shots[s]:,} | {'yes' if s in pbp else '**no**'} | "
                     f"{'yes' if s in box else 'no'} | {'yes' if s in trk else 'no'} |")

    (cfg.path("reports") / "DATA_VALIDATION.md").write_text("\n".join(lines),
                                                            encoding="utf-8")
    print("\n  wrote reports/DATA_VALIDATION.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
