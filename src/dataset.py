"""Load the processed splits + feature metadata for modelling."""
from __future__ import annotations
import json
from dataclasses import dataclass

import pandas as pd

from src.config import get_config


@dataclass
class Dataset:
    train: pd.DataFrame
    val: pd.DataFrame
    test: pd.DataFrame
    meta: dict
    # chronological sub-split of the validation season. val_fit drives early
    # stopping + model selection; val_cal is reserved for the calibrator so it is
    # never fitted on data a model early-stopped against. Both default to the full
    # validation season, reproducing v7 exactly when the split is disabled.
    val_fit: pd.DataFrame | None = None
    val_cal: pd.DataFrame | None = None

    def __post_init__(self):
        if self.val_fit is None:
            self.val_fit = self.val
        if self.val_cal is None:
            self.val_cal = self.val

    @property
    def features(self) -> list[str]:
        return self.meta["numeric"] + self.meta["categorical"]

    @property
    def target(self) -> str:
        return self.meta["target"]

    def xy(self, part: pd.DataFrame):
        return part[self.features], part[self.target].values

    def weights(self, part: pd.DataFrame):
        """Per-row training weight, or None when recency weighting is off.

        Only the training split is weighted. Validation stays unweighted so the
        selection metric measures performance on the deployment era as it is,
        not as the weighting wishes it were.
        """
        if "recency_weight" not in part.columns:
            return None
        return part["recency_weight"].to_numpy(dtype="float64")


def load_processed(cfg=None, with_test: bool = True) -> Dataset:
    cfg = cfg or get_config()
    p = cfg.path("data_processed")
    meta = json.loads((p / "feature_meta.json").read_text())
    train = pd.read_parquet(p / "train.parquet")
    val = pd.read_parquet(p / "validation.parquet")
    test = pd.read_parquet(p / "test.parquet") if with_test else None

    from src.data.splits import split_validation
    frac = float(getattr(getattr(cfg, "calibration", None), "holdout_frac", 0.0) or 0.0)
    val_fit, val_cal = split_validation(val, frac)
    return Dataset(train, val, test, meta, val_fit=val_fit, val_cal=val_cal)
