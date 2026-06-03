"""Chronological split by season. Never random — avoids temporal leakage."""
from __future__ import annotations
import numpy as np
import pandas as pd

from src.config import get_config


def split_validation(val: pd.DataFrame, holdout_frac: float = 0.0):
    """Split the validation season CHRONOLOGICALLY into (val_fit, val_cal).

    Why: the boosters early-stop on the validation season, the leaderboard selects
    on it, AND the calibrator is fitted on it. Predictions on data a model
    early-stopped against are optimistic, so an isotonic map fitted there
    under-corrects on the test season.

    `val_fit` (first 1-holdout_frac of games) drives early stopping and selection;
    `val_cal` (the last games) is seen by the calibrator only. Split by GAME_ID
    order, which is monotonic with date inside a season — the same device
    `studies/tracking_2016._chrono_split` uses — so the calibration slice is also
    the chronologically *latest*, i.e. closest to the test season.

    holdout_frac = 0 disables the split and returns (val, val), reproducing the
    v7 behaviour exactly.
    """
    if not holdout_frac:
        return val, val
    if not 0.0 < holdout_frac < 1.0:
        raise ValueError(f"calibration.holdout_frac must be in (0,1): {holdout_frac}")
    games = np.sort(val["GAME_ID"].unique())
    cut = int(round((1.0 - holdout_frac) * len(games)))
    fit_games = set(games[:cut])
    val_fit = val[val["GAME_ID"].isin(fit_games)]
    val_cal = val[~val["GAME_ID"].isin(fit_games)]
    if len(val_cal) < 5000:                    # too small to fit isotonic reliably
        raise ValueError(
            f"calibration slice has only {len(val_cal)} rows — lower holdout_frac")
    return val_fit.copy(), val_cal.copy()


def chronological_split(df: pd.DataFrame, cfg=None):
    """Return (train, val, test) frames split by SEASON per config."""
    cfg = cfg or get_config()
    train_seasons = set(cfg.data.seasons_train)
    val_season = cfg.data.season_val
    test_season = cfg.data.season_test

    train = df[df["SEASON"].isin(train_seasons)].copy()
    val = df[df["SEASON"] == val_season].copy()
    test = df[df["SEASON"] == test_season].copy()

    # guard: season sets disjoint, and GAME_IDs do not leak across splits
    assert train_seasons.isdisjoint({val_season, test_season})
    tr_games = set(train["GAME_ID"])
    assert tr_games.isdisjoint(set(val["GAME_ID"])), "GAME_ID leak train/val"
    assert tr_games.isdisjoint(set(test["GAME_ID"])), "GAME_ID leak train/test"
    return train, val, test
