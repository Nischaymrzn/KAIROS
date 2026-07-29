"""
cleanup_data.py — reclaim disk by removing redundant files in data/.

Tiers 1+2 (zero unique-data-loss):
  Tier 1: every .git/ history inside the cloned repos under data/ (we are not
          contributing to those repos, so their history is dead weight).
  Tier 2: data/csv/ — play_by_play.csv is a confirmed exact duplicate of the
          sqlite play_by_play table (13,592,899 rows in both); game/line_score/
          inactive_players are also sqlite tables. nba.sqlite stays canonical.

DRY RUN BY DEFAULT. It prints exactly what would be removed and the reclaim
total, and deletes nothing. Re-run with --execute to actually delete.

Usage:
    python scripts/cleanup_data.py            # dry run (safe, default)
    python scripts/cleanup_data.py --execute  # perform deletion
"""
from __future__ import annotations
import os
import shutil
import sys
from pathlib import Path

# Project root = parent of this scripts/ folder; data dir beside it.
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def dir_size(path: Path) -> int:
    total = 0
    for dirpath, _, filenames in os.walk(path, onerror=lambda e: None):
        for f in filenames:
            fp = Path(dirpath) / f
            try:
                total += fp.stat().st_size
            except OSError:
                pass
    return total


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def collect_targets() -> list[Path]:
    targets: list[Path] = []
    # Tier 1: all .git directories under data/
    targets += sorted(DATA.rglob(".git"))
    # Tier 2: the csv/ folder (duplicate of sqlite tables)
    csv_dir = DATA / "csv"
    if csv_dir.exists():
        targets.append(csv_dir)
    # Only keep paths that actually exist and are directories.
    return [t for t in targets if t.exists()]


def main() -> int:
    execute = "--execute" in sys.argv
    if not DATA.exists():
        print(f"ERROR: data dir not found at {DATA}")
        return 1

    targets = collect_targets()
    if not targets:
        print("Nothing to clean — no targets found.")
        return 0

    print(f"{'EXECUTE' if execute else 'DRY RUN'} — cleanup of {DATA}\n")
    grand = 0
    for t in targets:
        sz = dir_size(t)
        grand += sz
        rel = t.relative_to(DATA)
        print(f"  [{human(sz):>9}]  data/{rel}")
        if execute:
            try:
                shutil.rmtree(t)
            except OSError as e:
                print(f"      !! failed: {e}")

    print(f"\n  {'Reclaimed' if execute else 'Would reclaim'}: {human(grand)} "
          f"across {len(targets)} paths")
    if not execute:
        print("\n  Dry run only — nothing was deleted. "
              "Re-run with --execute to delete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
