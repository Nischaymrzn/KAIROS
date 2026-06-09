"""Name -> model dispatch, plus a unified fit/predict interface so train.py can
loop over every model the same way."""
from __future__ import annotations

import numpy as np

from src.models.classical import CLASSICAL_NAMES, fit_classical, predict_proba as _clf_predict
from src.models.deep_tabular import fit_deep, predict_proba_deep

DEEP_NAMES = ["mlp", "fttransformer", "tabnet"]
ALL_NAMES = CLASSICAL_NAMES + DEEP_NAMES


def fit(name: str, ds, cfg=None) -> dict:
    if name in CLASSICAL_NAMES:
        return fit_classical(name, ds, cfg)
    if name == "mlp":
        return fit_deep(ds, cfg)
    if name == "fttransformer":
        from src.models.ft_transformer import fit_ft
        return fit_ft(ds, cfg)
    if name == "tabnet":
        from src.models.tabnet_model import fit_tabnet
        return fit_tabnet(ds, cfg)
    raise ValueError(f"unknown model: {name}")


def predict_proba(bundle: dict, X) -> np.ndarray:
    kind = bundle.get("kind")
    if kind == "deep":
        return predict_proba_deep(bundle, X)
    if kind == "ft":
        from src.models.ft_transformer import predict_proba_ft
        return predict_proba_ft(bundle, X)
    if kind == "tabnet":
        from src.models.tabnet_model import predict_proba_tabnet
        return predict_proba_tabnet(bundle, X)
    return _clf_predict(bundle, X)
