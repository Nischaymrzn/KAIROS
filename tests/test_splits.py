"""The split must be chronological with no game leaking across splits."""
import pytest

from src.config import get_config
from src.dataset import load_processed


@pytest.fixture(scope="module")
def ds():
    return load_processed(get_config())


def test_seasons_disjoint(ds):
    cfg = get_config()
    tr = set(ds.train["SEASON"]); va = set(ds.val["SEASON"]); te = set(ds.test["SEASON"])
    assert tr == set(cfg.data.seasons_train)
    assert va == {cfg.data.season_val}
    assert te == {cfg.data.season_test}
    assert tr.isdisjoint(va) and tr.isdisjoint(te) and va.isdisjoint(te)


def test_no_game_leak(ds):
    g_tr = set(ds.train["GAME_ID"])
    assert g_tr.isdisjoint(set(ds.val["GAME_ID"]))
    assert g_tr.isdisjoint(set(ds.test["GAME_ID"]))
