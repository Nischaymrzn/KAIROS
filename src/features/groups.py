"""Feature-group definitions — the single source of truth shared by the ablation
study (`src.models.ablation`) and the feature build (`src.features.build`).

A group can be excluded from the model via `config.yaml -> features.drop_groups`.
Dropped groups are still *computed* (they remain in the processed parquet for
analysis and for the dashboard) but are excluded from `feature_meta.json`, so no
model ever sees them.

Ablation verdicts measured 2026-07-09 on the validation season (LightGBM):
    possession  +0.0015 AUC  -> KEEP
    rhythm      +0.0002 AUC  -> noise
    rest        -0.0002 AUC  -> drop
    combine     -0.0003 AUC  -> drop
    game_state  -0.0001 AUC  -> drop
    contest      restored 2026-08-13  -> KEEP (see below)

The `contest` group was previously called `dead` and was dropped, correctly, for
a reason that no longer holds. Per-shot defender distance and the pre-shot
movement proxies are public only for 2014-15 (shot logs) and 2015-16 (SportVU).
While the training window was 2021-22 to 2023-24 those seasons were not in it,
so every row carried the same imputed constant, a column with zero variance that
no model can split on.

Two things changed together. `src/data/contest.py` now recovers the real
measurements for those two seasons, and the training window was widened to
2014-15 onward, so the seasons that carry them are inside it. The columns now
vary across roughly 208,000 training rows and are flagged as imputed elsewhere,
which is exactly the pattern the companion flags were built for.

The consequence worth naming: the core model can once again split on defender
distance, so the dashboard's defender control moves the prediction instead of
being silently ignored. `src/serve/predict.py` reads this from the fitted
feature list rather than asserting it, so the claim can never drift from the
artefact.
"""
from __future__ import annotations

# Real per-shot contest measurements, available for 2014-15 and 2015-16 and
# imputed-with-flag elsewhere. Constant only if the training window excludes
# both of those seasons, which `build.py` now detects and reports rather than
# assuming either way.
CONTEST_COLUMNS: list[str] = [
    "defender_distance", "defender_distance_is_imputed", "contest_category",
    "dribbles", "dribbles_is_imputed",
    "touch_time", "touch_time_is_imputed", "dribble_rate",
]

DEAD_CONSTANT_COLUMNS = CONTEST_COLUMNS  # retired alias

FEATURE_GROUPS: dict[str, list[str]] = {
    "contest": CONTEST_COLUMNS,
    "possession": [
        "shot_clock", "shot_clock_is_imputed", "shot_clock_urgency",
        "poss_elapsed", "poss_elapsed_is_imputed",
        "secs_since_prev_event", "secs_since_prev_event_is_imputed",
        "is_transition", "poss_reset_type", "prev_event_type",
    ],
    "rhythm": [
        "prior_attempts", "prior_attempts_is_imputed",
        "prior_makes", "prior_makes_is_imputed",
        "prior_fg", "prior_fg_is_imputed",
        "secs_since_last_shot", "secs_since_last_shot_is_imputed",
    ],
    "rest": [
        "rest_days", "rest_days_is_imputed", "is_b2b", "is_b2b_is_imputed",
        "games_last_7", "games_last_7_is_imputed",
    ],
    # measured 2026-08-13, reports/TRACKING_ABLATION.md: best candidate reached
    # +0.00052 val AUC against a +0.001 bar, and all six together +0.0007. Points
    # restatements of rates the model already has, plus two season-level workload
    # measures that cannot resolve a single attempt.
    "tracking_volume": [
        "drive_pts", "drive_pts_is_imputed",
        "catch_shoot_pts", "catch_shoot_pts_is_imputed",
        "pull_up_pts", "pull_up_pts_is_imputed",
        "dist_miles", "dist_miles_is_imputed",
        "time_of_poss", "time_of_poss_is_imputed",
        "paint_touch_fg_pct", "paint_touch_fg_pct_is_imputed",
    ],
    "combine": [
        "wingspan_in", "wingspan_in_is_imputed",
        "standing_reach_in", "standing_reach_in_is_imputed",
        "max_vertical_in", "max_vertical_in_is_imputed",
    ],
    "game_state": [
        "score_margin", "score_margin_is_imputed", "is_home", "is_home_is_imputed",
        "opp_def_rating", "opp_def_rating_is_imputed",
        "opp_pace", "opp_pace_is_imputed", "is_clutch",
    ],
}


def dropped_columns(drop_groups) -> set[str]:
    """Column names belonging to any of the named groups."""
    out: set[str] = set()
    for g in (drop_groups or []):
        out.update(FEATURE_GROUPS.get(str(g), []))
    return out
