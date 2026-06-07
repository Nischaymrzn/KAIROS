"""Classical CPU models behind one interface: a shared scaler+one-hot
preprocessor, then fit each estimator (early stopping on the validation season
for the boosters, respecting chronology — no cross-validation)."""
from __future__ import annotations

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier

from src.config import get_config

CLASSICAL_NAMES = ["logreg", "rf", "xgboost", "lightgbm", "catboost"]


def _gpu_available() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def make_preprocessor(meta: dict) -> ColumnTransformer:
    try:
        ohe = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        ohe = OneHotEncoder(handle_unknown="ignore", sparse=False)
    return ColumnTransformer(
        [("num", StandardScaler(), meta["numeric"]),
         ("cat", ohe, meta["categorical"])],
        sparse_threshold=0,
    )


def fit_classical(name: str, ds, cfg=None) -> dict:
    """Fit one classical model. Returns a bundle {name, preprocessor, model}."""
    cfg = cfg or get_config()
    pre = make_preprocessor(ds.meta)
    Xtr, ytr = ds.xy(ds.train)
    wtr = ds.weights(ds.train)   # recency weighting; None when disabled
    # early stopping uses val_fit, NOT the full validation season: the calibrator is
    # fitted on the disjoint val_cal slice so it never sees data the booster stopped
    # against. With calibration.holdout_frac = 0 these are identical (v7 behaviour).
    Xva, yva = ds.xy(ds.val_fit)
    Xtr_t = pre.fit_transform(Xtr).astype("float32")
    Xva_t = pre.transform(Xva).astype("float32")

    if name == "logreg":
        p = cfg.models.logreg
        model = LogisticRegression(max_iter=p.max_iter, C=p.C)
        model.fit(Xtr_t, ytr, sample_weight=wtr)
    elif name == "rf":
        p = cfg.models.rf
        model = RandomForestClassifier(
            n_estimators=p.n_estimators, max_depth=p.max_depth,
            min_samples_leaf=p.min_samples_leaf, n_jobs=p.n_jobs,
            random_state=cfg.seed)
        model.fit(Xtr_t, ytr, sample_weight=wtr)
    elif name == "xgboost":
        from xgboost import XGBClassifier
        p = cfg.models.xgboost
        device = getattr(p, "device", "cpu") if _gpu_available() else "cpu"
        print(f"  xgboost on {device}")
        model = XGBClassifier(
            tree_method=p.tree_method, device=device, n_estimators=p.n_estimators,
            learning_rate=p.learning_rate, max_depth=p.max_depth,
            subsample=p.subsample, colsample_bytree=p.colsample_bytree,
            n_jobs=p.n_jobs, eval_metric="logloss",
            early_stopping_rounds=p.early_stopping_rounds, random_state=cfg.seed)
        model.fit(Xtr_t, ytr, sample_weight=wtr,
                  eval_set=[(Xva_t, yva)], verbose=False)
    elif name == "lightgbm":
        from lightgbm import LGBMClassifier, early_stopping, log_evaluation
        p = cfg.models.lightgbm
        params = dict(
            n_estimators=p.n_estimators, learning_rate=p.learning_rate,
            num_leaves=p.num_leaves, feature_fraction=p.feature_fraction,
            bagging_fraction=p.bagging_fraction, n_jobs=p.n_jobs,
            random_state=cfg.seed)
        # optional tuned params (only passed if present in config)
        for k in ("max_depth", "min_child_samples", "reg_lambda"):
            if hasattr(p, k):
                params[k] = getattr(p, k)
        model = LGBMClassifier(**params)
        model.fit(Xtr_t, ytr, sample_weight=wtr, eval_set=[(Xva_t, yva)],
                  callbacks=[early_stopping(100), log_evaluation(0)])
    elif name == "catboost":
        from catboost import CatBoostClassifier
        p = cfg.models.catboost
        task = p.task_type if (p.task_type == "GPU" and _gpu_available()) else "CPU"
        print(f"  catboost on {task}")
        params = dict(
            iterations=p.iterations, learning_rate=p.learning_rate,
            depth=p.depth, task_type=task, random_seed=cfg.seed, verbose=False)
        for k in ("l2_leaf_reg", "random_strength", "bagging_temperature"):
            if hasattr(p, k):
                params[k] = getattr(p, k)
        try:
            model = CatBoostClassifier(**params)
            model.fit(Xtr_t, ytr, sample_weight=wtr, eval_set=(Xva_t, yva),
                      early_stopping_rounds=100, verbose=False)
        except Exception as e:  # 6 GB cards OOM as the training set grows
            if task != "GPU":
                raise
            print(f"  catboost GPU failed ({str(e)[:60]}...) -> retrying on CPU")
            params["task_type"] = "CPU"
            model = CatBoostClassifier(**params)
            model.fit(Xtr_t, ytr, sample_weight=wtr, eval_set=(Xva_t, yva),
                      early_stopping_rounds=100, verbose=False)
    else:
        raise ValueError(f"unknown classical model: {name}")

    return {"name": name, "preprocessor": pre, "model": model, "kind": "classical"}


def predict_proba(bundle: dict, X) -> np.ndarray:
    Xt = bundle["preprocessor"].transform(X).astype("float32")
    return bundle["model"].predict_proba(Xt)[:, 1]
