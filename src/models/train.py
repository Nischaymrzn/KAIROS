"""Train one or all models, evaluate on validation, log to MLflow, save bundles.

Usage:
    python -m src.models.train --model all
    python -m src.models.train --model catboost
    python -m src.models.train --model mlp
"""
from __future__ import annotations
import argparse
import json
import time

import joblib

from src.config import get_config
from src.seeds import set_global_seed
from src.dataset import load_processed
from src.models.registry import ALL_NAMES, fit, predict_proba
from src.models.evaluate import metrics
from src.models.baseline_xp import evaluate_baseline


def _mlflow():
    try:
        import os
        os.environ["MLFLOW_ALLOW_FILE_STORE"] = "true"
        import mlflow
        cfg = get_config()
        mlflow.set_tracking_uri((cfg.path("mlruns")).as_uri())
        mlflow.set_experiment("hoopiq_shot_quality")
        return mlflow
    except Exception as e:  # noqa: BLE001
        print(f"  (mlflow unavailable: {e})")
        return None


def train_one(name: str, ds, cfg, mlflow) -> dict:
    t = time.time()
    bundle = fit(name, ds, cfg)
    pv = predict_proba(bundle, ds.val)  # full frame: deep model also needs player_id
    m = metrics(ds.val["MADE"], pv)
    dt = time.time() - t
    print(f"  [{name:9}] val AUC {m['auc']:.4f}  Brier {m['brier']:.4f}  ({dt:.0f}s)")

    joblib.dump(bundle, cfg.path("models") / f"{name}.joblib")
    if mlflow:
        with mlflow.start_run(run_name=name):
            mlflow.log_param("model", name)
            mlflow.log_param("tier", cfg.data.tier)
            mlflow.log_metrics({f"val_{k}": v for k, v in m.items()
                                if isinstance(v, (int, float))})
    return {"name": name, **m, "seconds": round(dt, 1)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="all")
    ap.add_argument("--tier", default=None)
    args = ap.parse_args()
    cfg = get_config()
    if args.tier:
        cfg.data.tier = args.tier
    set_global_seed(cfg.seed)

    ds = load_processed(cfg, with_test=False)  # never touch test in training
    mlflow = _mlflow()
    names = ALL_NAMES if args.model == "all" else [args.model]

    base = evaluate_baseline(with_test=False)["val"]
    print(f"xP baseline val AUC {base['auc']:.4f}\n")

    rows = []
    for name in names:
        try:
            rows.append(train_one(name, ds, cfg, mlflow))
        except Exception as e:  # noqa: BLE001
            print(f"  [{name}] FAILED: {e}")

    rows.sort(key=lambda r: r["auc"], reverse=True)
    board = {"baseline_val_auc": base["auc"], "models": rows}
    (cfg.path("models") / "leaderboard.json").write_text(json.dumps(board, indent=2))

    print("\nLeaderboard (validation, by AUC):")
    print(f"  {'baseline':9} {base['auc']:.4f}")
    for r in rows:
        print(f"  {r['name']:9} {r['auc']:.4f}  (+{r['auc']-base['auc']:.4f})")
    if rows:
        assert rows[0]["auc"] > base["auc"], "no model beat the baseline"
        print("\n  ACCEPT: best model beats the xP baseline on validation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
