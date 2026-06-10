"""Bounded, chronological hyperparameter search for the two best boosters
(CatBoost + LightGBM) with Optuna. The objective is **validation-season AUC** —
no cross-validation, so the chronological split is never violated. CatBoost runs
on GPU when available; LightGBM on CPU.

The preprocessor (scaler + one-hot) is fit once on train and reused across all
trials, so a trial is just a booster fit. Best params are written to
`models/tuning/best_{model}.json` (+ MLflow); apply the winners into `config.yaml`
after inspecting the results.

CLI:  python -m src.models.tune --model both
      python -m src.models.tune --model catboost --trials 25
"""
from __future__ import annotations
import argparse
import json
import time

import numpy as np
from sklearn.metrics import roc_auc_score

from src.config import get_config
from src.seeds import set_global_seed
from src.dataset import load_processed
from src.models.classical import make_preprocessor, _gpu_available


def _prepare(ds):
    """Fit the shared preprocessor on train; return dense train/val matrices."""
    pre = make_preprocessor(ds.meta)
    Xtr, ytr = ds.xy(ds.train)
    Xva, yva = ds.xy(ds.val)
    Xtr_t = pre.fit_transform(Xtr).astype("float32")
    Xva_t = pre.transform(Xva).astype("float32")
    return Xtr_t, np.asarray(ytr), Xva_t, np.asarray(yva)


def _tune_lightgbm(data, cfg, n_trials, stop):
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation
    Xtr, ytr, Xva, yva = data

    def objective(trial):
        params = dict(
            n_estimators=5000,
            learning_rate=trial.suggest_float("learning_rate", 0.01, 0.1, log=True),
            num_leaves=trial.suggest_int("num_leaves", 31, 255),
            max_depth=trial.suggest_int("max_depth", 4, 16),
            min_child_samples=trial.suggest_int("min_child_samples", 10, 300),
            feature_fraction=trial.suggest_float("feature_fraction", 0.5, 1.0),
            bagging_fraction=trial.suggest_float("bagging_fraction", 0.5, 1.0),
            reg_lambda=trial.suggest_float("reg_lambda", 1e-3, 10.0, log=True),
            n_jobs=-1, random_state=cfg.seed)
        m = LGBMClassifier(**params)
        m.fit(Xtr, ytr, eval_set=[(Xva, yva)],
              callbacks=[early_stopping(stop), log_evaluation(0)])
        return roc_auc_score(yva, m.predict_proba(Xva)[:, 1])

    return _run_study("lightgbm", objective, n_trials, cfg)


def _tune_catboost(data, cfg, n_trials, stop):
    from catboost import CatBoostClassifier
    Xtr, ytr, Xva, yva = data
    task = "GPU" if (_gpu_available() and cfg.models.catboost.task_type == "GPU") else "CPU"
    print(f"  catboost tuning on {task}")

    def objective(trial):
        params = dict(
            iterations=5000,
            learning_rate=trial.suggest_float("learning_rate", 0.01, 0.1, log=True),
            depth=trial.suggest_int("depth", 4, 10),
            l2_leaf_reg=trial.suggest_float("l2_leaf_reg", 1.0, 12.0, log=True),
            random_strength=trial.suggest_float("random_strength", 0.0, 2.0),
            bagging_temperature=trial.suggest_float("bagging_temperature", 0.0, 1.0),
            task_type=task, random_seed=cfg.seed, verbose=False)
        m = CatBoostClassifier(**params)
        m.fit(Xtr, ytr, eval_set=(Xva, yva), early_stopping_rounds=stop, verbose=False)
        return roc_auc_score(yva, m.predict_proba(Xva)[:, 1])

    return _run_study("catboost", objective, n_trials, cfg)


def _run_study(name, objective, n_trials, cfg):
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=cfg.seed))
    t = time.time()
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)
    dt = time.time() - t
    print(f"  [{name}] {n_trials} trials in {dt:.0f}s | "
          f"best val AUC {study.best_value:.4f} | params {study.best_params}")

    out_dir = cfg.path("models") / "tuning"
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {"model": name, "best_val_auc": float(study.best_value),
               "best_params": study.best_params, "n_trials": n_trials,
               "seconds": round(dt, 1)}
    (out_dir / f"best_{name}.json").write_text(json.dumps(payload, indent=2))
    return payload


def _log_mlflow(results):
    try:
        import os
        os.environ["MLFLOW_ALLOW_FILE_STORE"] = "true"
        import mlflow
        cfg = get_config()
        mlflow.set_tracking_uri((cfg.path("mlruns")).as_uri())
        mlflow.set_experiment("hoopiq_tuning")
        for r in results:
            with mlflow.start_run(run_name=f"tune_{r['model']}"):
                mlflow.log_params({f"{r['model']}_{k}": v
                                   for k, v in r["best_params"].items()})
                mlflow.log_metric("best_val_auc", r["best_val_auc"])
    except Exception as e:  # noqa: BLE001
        print(f"  (mlflow unavailable: {e})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="both", choices=["both", "catboost", "lightgbm"])
    ap.add_argument("--trials", type=int, default=None, help="override config")
    args = ap.parse_args()
    cfg = get_config()
    set_global_seed(cfg.seed)

    ds = load_processed(cfg, with_test=False)
    data = _prepare(ds)
    print(f"tuning on {ds.train.shape[0]:,} train / {ds.val.shape[0]:,} val rows, "
          f"{len(ds.meta['numeric'])} numeric features\n")

    tcb = args.trials or cfg.tune.n_trials_catboost
    tlgb = args.trials or cfg.tune.n_trials_lightgbm
    results = []
    if args.model in ("both", "lightgbm"):
        results.append(_tune_lightgbm(data, cfg, tlgb, cfg.tune.early_stopping))
    if args.model in ("both", "catboost"):
        results.append(_tune_catboost(data, cfg, tcb, cfg.tune.early_stopping))

    _log_mlflow(results)

    # honest reference: current (untuned) val AUC from the leaderboard
    board = json.loads((cfg.path("models") / "leaderboard.json").read_text())
    cur = {m["name"]: m["auc"] for m in board.get("models", [])}
    print("\nTuning summary (val AUC, tuned vs current):")
    for r in results:
        base = cur.get(r["model"])
        delta = f"(+{r['best_val_auc']-base:.4f})" if base else ""
        print(f"  {r['model']:9} {r['best_val_auc']:.4f} {delta}")
    print("\n  Next: apply the winning params into config.yaml, then "
          "`make train` + calibrate + evaluate.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
