"""Shared data prep for the 2015-16 full-tracking shot-quality model (Model 2).

Joins the flat per-shot tracking features (`shots_tracking.parquet`) with the
per-shot player SET (`shots_players.npz`) on (GAME_ID, GAME_EVENT_ID), applies a
game-level chronological split (70/15/15 — no game spans two splits), fits shooter
skill on TRAIN only, and clips the physically-impossible kinematic outliers the
EDA flagged. Emits everything the boosting baselines and the Set-Transformer need.

Strict leakage guard: no `post_*` column may survive here (asserted).
"""
from __future__ import annotations
from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.config import get_config

# global (non-defender-geometry) shot context — shared by every model. The SET
# supplies defender geometry to the set-model; the boosting baselines additionally
# get the hand-engineered aggregates (AGG) so we can test set vs aggregates fairly.
CONTEXT = ["SHOT_DISTANCE", "is_3", "period", "pre_shot_clock",
           "pre_release_height", "pre_time_with_ball", "pre_shooter_speed",
           "player_fg"]
AGG = ["pre_def_dist", "pre_def_dist_2", "pre_def_angle", "pre_help_defenders",
       "pre_closing_speed", "pre_def_x_3"]
SPEED_CAP = 40.0


@dataclass
class TrackingData:
    train: pd.DataFrame
    val: pd.DataFrame
    test: pd.DataFrame
    set_tr: np.ndarray          # (n_train, K, F)
    set_va: np.ndarray
    set_te: np.ndarray
    mask_tr: np.ndarray         # (n_train, K)
    mask_va: np.ndarray
    mask_te: np.ndarray
    set_feature_names: list


def _load_flat(cfg) -> pd.DataFrame:
    d = pd.read_parquet(cfg.path("data_movement") / "shots_tracking.parquet")
    post = [c for c in d.columns if c.startswith("post_")]
    d = d.drop(columns=post)                       # never enter the model
    assert not [c for c in d.columns if c.startswith("post_")]
    d["is_3"] = (d["SHOT_TYPE"].astype("string") == "3PT Field Goal").astype(int)
    d["period"] = d["PERIOD"].astype(int)
    d["MADE"] = d["MADE"].astype(int)
    d["pre_def_x_3"] = d["pre_def_dist"] * d["is_3"]
    for c in CONTEXT + AGG:
        if c in d.columns:
            d[c] = pd.to_numeric(d[c], errors="coerce")
    # clip the frame-dt division blow-ups the EDA flagged
    for c in ("pre_shooter_speed", "pre_closing_speed"):
        d[c] = d[c].clip(-SPEED_CAP, SPEED_CAP)
    d["_key"] = list(zip(d["GAME_ID"].astype("int64"), d["GAME_EVENT_ID"].astype("int64")))
    return d


def _load_sets(cfg):
    z = np.load(cfg.path("data_movement") / "shots_players.npz", allow_pickle=True)
    keys = list(zip(z["game_id"].tolist(), z["game_event_id"].tolist()))
    idx = {k: i for i, k in enumerate(keys)}
    return z["feat"].astype("float32"), z["mask"].astype("float32"), idx, \
        list(z["feature_names"])


def _chrono_split(df: pd.DataFrame):
    games = np.sort(df["GAME_ID"].unique())
    n = len(games)
    tr = set(games[: int(0.70 * n)])
    va = set(games[int(0.70 * n): int(0.85 * n)])
    te = set(games[int(0.85 * n):])
    return (df[df["GAME_ID"].isin(tr)].copy(),
            df[df["GAME_ID"].isin(va)].copy(),
            df[df["GAME_ID"].isin(te)].copy())


def load_tracking_data(cfg=None) -> TrackingData:
    cfg = cfg or get_config()
    flat = _load_flat(cfg)
    feat, mask, idx, set_names = _load_sets(cfg)

    # keep only shots present in BOTH artifacts (identical release logic -> ~all)
    flat = flat[flat["_key"].map(lambda k: k in idx)].reset_index(drop=True)
    rowset = flat["_key"].map(idx).to_numpy()

    train, val, test = _chrono_split(flat)

    # shooter skill fit on TRAIN only, mapped to val/test
    p_fg = train.groupby("PLAYER_ID")["MADE"].mean()
    glob = float(train["MADE"].mean())
    for part in (train, val, test):
        part["player_fg"] = part["PLAYER_ID"].map(p_fg).fillna(glob).astype("float32")

    # impute context/aggregate NaNs with TRAIN medians (e.g. pre_shot_clock is
    # ~5% missing). Boosting fills internally, but the Set-Transformer standardises
    # its context and any NaN would propagate to a NaN prediction — so fill here,
    # once, on train-fit medians (no leakage), for every model.
    imp_cols = [c for c in CONTEXT + AGG if c in train.columns]
    med = train[imp_cols].median()
    for part in (train, val, test):
        part[imp_cols] = part[imp_cols].fillna(med)

    def _sel(part):
        rows = rowset[part.index.to_numpy()]
        return feat[rows], mask[rows]

    set_tr, mask_tr = _sel(train)
    set_va, mask_va = _sel(val)
    set_te, mask_te = _sel(test)
    for part in (train, val, test):
        part.reset_index(drop=True, inplace=True)

    return TrackingData(train, val, test, set_tr, set_va, set_te,
                        mask_tr, mask_va, mask_te, set_names)


if __name__ == "__main__":
    d = load_tracking_data()
    print(f"train {len(d.train):,} | val {len(d.val):,} | test {len(d.test):,}")
    print(f"set tensor: {d.set_tr.shape} features {d.set_feature_names}")
    print(f"make rate  train {d.train['MADE'].mean():.3f} "
          f"val {d.val['MADE'].mean():.3f} test {d.test['MADE'].mean():.3f}")
    print(f"mean defenders/shot (train): "
          f"{(d.set_tr[:,:,4]*d.mask_tr).sum(1).mean():.2f}")
