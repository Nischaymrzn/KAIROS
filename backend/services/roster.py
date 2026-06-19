"""Roster service — real players from the frozen model's player lookup.

The production bundle ships `player_lookup.joblib`: 1017 real NBA player ids ->
their physical/tracking/skill profile as the model consumes it (height, wingspan,
standing reach, max vertical, avg speed, drive/catch-shoot/pull-up rates...).

`VERIFIED_PLAYERS` maps canonical NBA ids to display names. Every entry was
verified against the lookup itself (id present AND listed height matches the
player's real height, non-imputed) — see DEVLOG 2026-07-16. Ids outside this map
are still fully queryable by id; they simply have no display name.
"""
from __future__ import annotations

from typing import Optional

from src.serve.predict import _load

# id -> (name, position group). Height-verified against player_lookup.
VERIFIED_PLAYERS: dict[int, tuple[str, str]] = {
    201939: ("Stephen Curry", "G"),
    201142: ("Kevin Durant", "F"),
    203507: ("Giannis Antetokounmpo", "F"),
    203999: ("Nikola Jokic", "C"),
    1629029: ("Luka Doncic", "G"),
    1628369: ("Jayson Tatum", "F"),
    1628378: ("Donovan Mitchell", "G"),
    203081: ("Damian Lillard", "G"),
    1629627: ("Zion Williamson", "F"),
    201935: ("James Harden", "G"),
    202681: ("Kyrie Irving", "G"),
    202710: ("Jimmy Butler", "F"),
    203076: ("Anthony Davis", "F"),
    1630162: ("Anthony Edwards", "G"),
    1630169: ("Tyrese Haliburton", "G"),
    1628368: ("De'Aaron Fox", "G"),
    1630178: ("Tyrese Maxey", "G"),
    1629027: ("Trae Young", "G"),
    201566: ("Russell Westbrook", "G"),
    202331: ("Paul George", "F"),
    202691: ("Klay Thompson", "G"),
    203110: ("Draymond Green", "F"),
    101108: ("Chris Paul", "G"),
    203944: ("Julius Randle", "F"),
    1627749: ("Dejounte Murray", "G"),
    1628960: ("Grayson Allen", "G"),
    203952: ("Andrew Wiggins", "F"),
    1627732: ("Ben Simmons", "G"),
    202689: ("Kemba Walker", "G"),
    201580: ("JaVale McGee", "C"),
    1627734: ("Domantas Sabonis", "C"),
    203497: ("Rudy Gobert", "C"),
    204001: ("Kristaps Porzingis", "C"),
    203114: ("Khris Middleton", "F"),
    1628969: ("Mikal Bridges", "F"),
    1628384: ("OG Anunoby", "F"),
    1629008: ("Michael Porter Jr.", "F"),
    # ---- stars whose bio fields are LEAGUE-IMPUTED in the profile source; their
    # ids still carry REAL per-player shot-history features, so predictions are
    # genuinely theirs. The API flags bio_source so the UI can say so. ----
    2544: ("LeBron James", "F"),
    203954: ("Joel Embiid", "C"),
    1626164: ("Devin Booker", "G"),
    1628983: ("Shai Gilgeous-Alexander", "G"),
    1629630: ("Ja Morant", "G"),
    202695: ("Kawhi Leonard", "F"),
    1626157: ("Karl-Anthony Towns", "C"),
    203897: ("Zach LaVine", "G"),
    1627759: ("Jaylen Brown", "F"),
    1641705: ("Victor Wembanyama", "C"),
    1628973: ("Jalen Brunson", "G"),
    1629636: ("Darius Garland", "G"),
    1628389: ("Bam Adebayo", "C"),
    201942: ("DeMar DeRozan", "F"),
    201950: ("Jrue Holiday", "G"),
    1626172: ("Myles Turner", "C"),
    202699: ("Tobias Harris", "F"),
    202326: ("DeMarcus Cousins", "C"),
    201980: ("Danny Green", "G"),
    203468: ("CJ McCollum", "G"),
    1627750: ("Jamal Murray", "G"),
    203932: ("Aaron Gordon", "F"),
}

# profile fields worth surfacing (order = display order in the client)
PROFILE_FIELDS = [
    "height_in", "wingspan_in", "standing_reach_in", "max_vertical_in",
    "weight_lb", "experience_yrs", "avg_speed", "drives_pg", "drive_fg_pct",
    "catch_shoot_rate", "catch_shoot_fg_pct", "pull_up_rate", "pull_up_fg_pct",
    "paint_touches", "touches",
]


def _profile(row: dict) -> dict:
    """Split a lookup row into values + which of them are imputed."""
    values = {k: round(float(row[k]), 3) for k in PROFILE_FIELDS if k in row}
    imputed = sorted(
        k[: -len("_is_imputed")]
        for k, v in row.items()
        if k.endswith("_is_imputed") and float(v) >= 1.0
    )
    # bios (height/weight/wingspan...) measured, or league-median placeholders?
    bio_source = "league_imputed" if float(row.get("height_in_is_imputed", 0)) >= 1 else "measured"
    return {"profile": values, "imputed": imputed, "bio_source": bio_source}


def get_roster() -> list[dict]:
    """The verified named roster, profiles straight from the frozen lookup."""
    table = _load()["player_lookup"]["table"]
    out = []
    for pid, (name, pos) in VERIFIED_PLAYERS.items():
        row = table.get(pid)
        if row is None:  # bundle changed underneath us — skip, never fabricate
            continue
        out.append({"id": pid, "name": name, "position": pos, **_profile(row)})
    out.sort(key=lambda p: p["name"])
    return out


def get_player(pid: int) -> Optional[dict]:
    """Any of the lookup's player ids (named or not); None when unknown."""
    table = _load()["player_lookup"]["table"]
    row = table.get(pid)
    if row is None:
        return None
    name, pos = VERIFIED_PLAYERS.get(pid, (None, None))
    return {"id": pid, "name": name, "position": pos, **_profile(row)}


def roster_size() -> int:
    return len(_load()["player_lookup"]["table"])
