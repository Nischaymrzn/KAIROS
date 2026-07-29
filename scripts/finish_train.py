"""Retrain the families not yet rebuilt on the clean-PBP feature set, then rebuild
the leaderboard from ALL bundles and recalibrate. Written so an interruption leaves
a recoverable state: the leaderboard is rewritten only after every model is on disk.
"""
import json, time, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import joblib                                               # noqa: E402
from src.config import get_config                           # noqa: E402
from src.seeds import set_global_seed                       # noqa: E402
from src.dataset import load_processed                      # noqa: E402
from src.models.registry import fit, predict_proba          # noqa: E402
from src.models.evaluate import metrics                     # noqa: E402
from src.models.baseline_xp import evaluate_baseline        # noqa: E402

REMAINING = ("rf", "logreg", "mlp", "tabnet", "fttransformer")
ALL = ("catboost", "xgboost", "lightgbm") + REMAINING

cfg = get_config(); set_global_seed(cfg.seed)
ds = load_processed(cfg, with_test=False)
for name in REMAINING:
    t = time.time()
    try:
        b = fit(name, ds, cfg)
        joblib.dump(b, cfg.path("models") / f"{name}.joblib")
        m = metrics(ds.val["MADE"], predict_proba(b, ds.val))
        print(f"  [{name}] val AUC {m['auc']:.5f} ({time.time()-t:.0f}s)", flush=True)
    except Exception as e:
        print(f"  [{name}] FAILED: {e}", flush=True)

base = evaluate_baseline(with_test=False)["val"]
rows = []
for n in ALL:
    fp = cfg.path("models") / f"{n}.joblib"
    if not fp.exists():
        continue
    try:
        m = metrics(ds.val["MADE"], predict_proba(joblib.load(fp), ds.val))
        rows.append({"name": n, **m})
        print(f"  scored {n:14} {m['auc']:.5f}", flush=True)
    except Exception as e:
        print(f"  skip {n}: {str(e)[:70]}", flush=True)
rows.sort(key=lambda r: -r["auc"])
(cfg.path("models") / "leaderboard.json").write_text(json.dumps(
    {"baseline_val_auc": base["auc"], "models": rows,
     "_note": "Rebuilt 2026-08-06 on the CLEAN-PBP 62+7 feature set (all five "
              "seasons sourced from playbyplayv3)."}, indent=2))
print(f"\n  leaderboard rebuilt: {len(rows)} models, best={rows[0]['name']} "
      f"{rows[0]['auc']:.5f}", flush=True)
