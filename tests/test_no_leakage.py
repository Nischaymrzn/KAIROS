"""No feature may be derived from the shot outcome, and no game may appear in
more than one split."""
from src.config import get_config
from src.dataset import load_processed

FORBIDDEN = {"made", "shot_made", "outcome", "event_type", "result"}


def test_no_outcome_feature():
    ds = load_processed(get_config())
    feats = ds.meta["numeric"] + ds.meta["categorical"]
    assert all(f.lower() not in FORBIDDEN for f in feats)
    assert ds.meta["target"] not in feats


def test_no_feature_perfectly_predicts_target():
    """Guard against accidental leakage: no varying numeric feature should
    correlate near-perfectly with the target. Constant (imputed Tier-A) features
    have undefined correlation and cannot leak, so they are skipped."""
    import numpy as np
    ds = load_processed(get_config())
    y = ds.train["MADE"].astype(float)
    for f in ds.meta["numeric"]:
        col = ds.train[f].astype(float)
        if col.std() == 0:                       # constant -> cannot leak
            continue
        c = col.corr(y)
        assert not np.isnan(c) and abs(c) < 0.95, \
            f"feature {f} suspiciously correlated with target ({c:.2f})"


def test_games_unique_per_split():
    ds = load_processed(get_config())
    g_tr, g_va, g_te = (set(ds.train["GAME_ID"]), set(ds.val["GAME_ID"]),
                        set(ds.test["GAME_ID"]))
    assert g_tr.isdisjoint(g_va) and g_tr.isdisjoint(g_te) and g_va.isdisjoint(g_te)


def test_score_margin_is_not_outcome_leak():
    """The score margin must be the state BEFORE the shot. If the join picks up
    the shot's own scoring event (same-second), made shots inflate the margin and
    corr(score_margin, MADE) spikes (~0.10). The pre-shot margin is ~uncorrelated
    with the individual outcome (|corr| < 0.05)."""
    ds = load_processed(get_config())
    if "score_margin" not in ds.train.columns:
        return
    real = ds.train[ds.train.get("score_margin_is_imputed", 0) == 0]
    if len(real) < 1000:
        return
    c = real["score_margin"].astype(float).corr(real["MADE"].astype(float))
    assert abs(c) < 0.05, f"score_margin leaks the outcome (corr={c:.3f})"


def test_no_post_release_features_in_production_model():
    """The 2015-16 tracking extraction emits `post_*` columns describing the
    ball's flight AFTER release. Those ARE the outcome (see
    reports/LEAKAGE_DEMO.md). They must never reach the production feature set."""
    ds = load_processed(get_config())
    feats = ds.meta["numeric"] + ds.meta["categorical"]
    leaked = [f for f in feats if f.startswith("post_")]
    assert not leaked, f"post-release (outcome) features in the model: {leaked}"


def test_tracking_study_excludes_post_features():
    """The honest tracking study must drop every post-release column."""
    from src.studies.tracking_2016 import TRACKING, BASE
    bad = [c for c in TRACKING + BASE if c.startswith("post_")]
    assert not bad, f"post-release features listed as legitimate: {bad}"


def test_tracking_model_excludes_post_features():
    """Model 2 (the Set-Transformer tracking model) must feed only pre-release
    features: neither the boosting context/aggregates nor the player-set features
    may be post-release ball flight."""
    from src.movement.tracking_data import CONTEXT, AGG
    from src.movement.extract_players import FEATURE_NAMES
    bad = [c for c in CONTEXT + AGG + FEATURE_NAMES if c.startswith("post_")]
    assert not bad, f"post-release features in the tracking model: {bad}"
    # the player-set features are pure geometry/kinematics, never the outcome
    assert "made" not in [f.lower() for f in FEATURE_NAMES]


def test_player_season_excludes_current_outcome():
    """Model 3 (elite shooting-efficiency) may use prior-season skill and current-
    season shot SELECTION/role, but NEVER a current-season shooting OUTCOME (TS%,
    FG%, FG%-by-zone, PER, WS, BPM). Every feature must be prior_/cur_/career_ or a
    known time-invariant attribute."""
    from src.data.player_season import (CUR_SELECTION, FORBIDDEN_CUR, DERIVED, ENRICH)
    # the current-season selection features are choices, not shooting outcomes
    assert not [c for c in CUR_SELECTION if c in FORBIDDEN_CUR], \
        "a current-season selection feature is actually a shooting outcome"
    # and the built dataset's features honour the boundary
    import json
    from src.config import get_config
    d = get_config().path("data_processed").parent / "processed_player"
    meta_fp = d / "feature_meta.json"
    if not meta_fp.exists():
        return
    feats = json.loads(meta_fp.read_text())["numeric"]
    bad = [c for c in feats if c in FORBIDDEN_CUR or c == "ts_percent"]
    assert not bad, f"current-season shooting outcome leaked into Model 3: {bad}"
    known = set(DERIVED) | set(ENRICH) | {f"{c}_is_imputed" for c in ENRICH}
    sus = [c for c in feats if not c.startswith(("prior_", "cur_", "career_")) and c not in known]
    assert not sus, f"Model 3 feature not clearly prior/selection/known: {sus}"


def test_possession_features_are_pre_shot():
    """Shot clock / transition come from events STRICTLY before the shot. If the
    join ever picked up the shot's own event, these would correlate strongly with
    the outcome. Real basketball signal is small (|corr| well under 0.15)."""
    ds = load_processed(get_config())
    for f in ("shot_clock", "is_transition", "poss_elapsed"):
        if f not in ds.train.columns:
            continue
        c = ds.train[f].astype(float).corr(ds.train["MADE"].astype(float))
        assert abs(c) < 0.15, f"{f} suspiciously correlated with target ({c:.3f})"


def test_prev_event_is_not_the_shot_itself():
    """A one-second clock mismatch could make a shot's own made/missed event its
    'previous event', which would leak the outcome. A self-leak would make
    prev_event=='made' spike on makes; it must not."""
    ds = load_processed(get_config())
    if "prev_event_type" not in ds.train.columns:
        return
    y = ds.train["MADE"].astype(int)
    made_prev = (ds.train["prev_event_type"].astype(str) == "made").astype(int)
    c = made_prev.corr(y.astype(float))
    assert abs(c) < 0.10, f"prev_event_type leaks the shot's own event ({c:.3f})"


def test_rhythm_excludes_current_shot():
    """prior_makes must never count the current shot: it can never exceed
    prior_attempts, and the first shot of a game has zero of both."""
    ds = load_processed(get_config())
    if "prior_makes" not in ds.train.columns:
        return
    tr = ds.train
    assert (tr["prior_makes"] <= tr["prior_attempts"] + 1e-6).all()
    first = tr[tr["prior_attempts"] == 0]
    assert (first["prior_makes"] == 0).all(), "first shot sees its own outcome"


def test_enrichment_coverage():
    """Real enrichments should cover most rows (else the join silently degraded
    to imputed constants)."""
    ds = load_processed(get_config())
    tr = ds.train
    if "score_margin_is_imputed" in tr:
        assert tr["score_margin_is_imputed"].mean() < 0.15
    if "is_home_is_imputed" in tr:
        assert tr["is_home_is_imputed"].mean() < 0.01   # home flag is fully real
    if "opp_def_rating_is_imputed" in tr:
        assert tr["opp_def_rating_is_imputed"].mean() < 0.05
