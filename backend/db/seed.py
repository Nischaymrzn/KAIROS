"""Deterministic daily challenge — the same challenge for everyone on a given
date, derived from the date so it is reproducible without storing randomness."""
from __future__ import annotations
from datetime import date

from backend.db.models import DailyChallenge

# challenge templates; the day picks one deterministically
_TEMPLATES = [
    ("catch_shoot", "Above the Break 3", "Drain a catch-and-shoot three above the break"),
    ("pullup", "Mid-Range", "Rise up for a pull-up mid-range jumper"),
    ("driving_layup", "Restricted Area", "Finish a driving layup at the rim"),
    ("stepback", "Above the Break 3", "Create space for a step-back three"),
    ("floater", "In The Paint (Non-RA)", "Drop a floater in the paint"),
    ("catch_shoot", "Left Corner 3", "Knock down a corner three"),
    ("fadeaway", "Mid-Range", "Hit a turnaround fadeaway"),
]


def challenge_for(day: date) -> DailyChallenge:
    seed = day.toordinal()
    verb, zone, desc = _TEMPLATES[seed % len(_TEMPLATES)]
    # a modest, reachable bar that nudges toward high-quality shots
    target = 0.42 + (seed % 5) * 0.02          # 0.42 .. 0.50
    return DailyChallenge(day=day, seed=seed, shot_type=verb, zone=zone,
                          target_prob=round(target, 2), description=desc)
