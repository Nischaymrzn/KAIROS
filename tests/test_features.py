"""The feature matrix must be complete, typed, and free of nulls."""
from src.config import get_config
from src.dataset import load_processed


def test_meta_groups_present():
    ds = load_processed(get_config())
    assert ds.meta["numeric"] and ds.meta["categorical"]
    assert "zone_fg_pct" in ds.meta["numeric"]
    assert "basic_zone" in ds.meta["categorical"]


def test_no_nulls_in_features():
    ds = load_processed(get_config())
    feats = ds.meta["numeric"] + ds.meta["categorical"]
    for part in (ds.train, ds.val, ds.test):
        assert part[feats].isna().sum().sum() == 0


def test_imputed_flags_exist():
    ds = load_processed(get_config())
    # every imputed source feature has a *_is_imputed companion column
    for f in ds.meta["imputed"]:
        assert f"{f}_is_imputed" in ds.train.columns
