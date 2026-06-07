"""Shared feature prep for the tabular deep-learning models (FT-Transformer,
TabNet). Standardises continuous features (fit on train) and integer-encodes the
categoricals — including high-cardinality `player_id` — so the networks can embed
them. An 'unknown' bucket (index 0) absorbs categories unseen in training."""
from __future__ import annotations

import numpy as np
import pandas as pd

# categoricals the deep models embed (meta categoricals + the player id)
def cat_columns(meta: dict) -> list[str]:
    cats = list(meta["categorical"])
    if "player_id" not in cats:
        cats = cats + ["player_id"]
    return cats


class DeepPrep:
    """Fit on train; transform any split into (X_cont float32, X_cat int64)."""

    def __init__(self, meta: dict):
        self.num = list(meta["numeric"])
        self.cat = cat_columns(meta)
        self.mean_ = None
        self.std_ = None
        self.maps_: dict[str, dict] = {}
        self.cardinalities: list[int] = []

    def fit(self, train: pd.DataFrame) -> "DeepPrep":
        X = train[self.num].to_numpy(dtype="float64")
        self.mean_ = np.nanmean(X, axis=0)
        self.std_ = np.nanstd(X, axis=0)
        self.std_[self.std_ < 1e-8] = 1.0
        for c in self.cat:
            vals = pd.Index(train[c].astype("string").fillna("NA").unique())
            # 0 is reserved for unknown / unseen
            self.maps_[c] = {v: i + 1 for i, v in enumerate(vals)}
            self.cardinalities.append(len(vals) + 1)
        return self

    def transform(self, part: pd.DataFrame):
        Xc = part[self.num].to_numpy(dtype="float64")
        Xc = np.nan_to_num((Xc - self.mean_) / self.std_).astype("float32")
        cats = np.zeros((len(part), len(self.cat)), dtype="int64")
        for j, c in enumerate(self.cat):
            m = self.maps_[c]
            s = part[c].astype("string").fillna("NA")
            cats[:, j] = s.map(lambda v: m.get(v, 0)).to_numpy(dtype="int64")
        return Xc, cats
