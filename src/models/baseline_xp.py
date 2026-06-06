"""Zone Expected-Points (xP) baseline — the number every model must beat.

The predicted make probability is the train-fit zone FG% (already a feature,
`zone_fg_pct`). Evaluated on validation (and test, at final evaluation).

CLI:  python -m src.models.baseline_xp
"""
from __future__ import annotations
import json

from src.config import get_config
from src.dataset import load_processed
from src.models.evaluate import metrics


def evaluate_baseline(with_test: bool = True) -> dict:
    cfg = get_config()
    ds = load_processed(cfg, with_test=with_test)
    out = {"val": metrics(ds.val["MADE"], ds.val["zone_fg_pct"])}
    if with_test and ds.test is not None:
        out["test"] = metrics(ds.test["MADE"], ds.test["zone_fg_pct"])
    fp = cfg.path("figures") / "baseline_metrics.json"
    fp.write_text(json.dumps(out, indent=2))
    return out


def main() -> int:
    out = evaluate_baseline(with_test=True)
    print(f"xP baseline  val AUC {out['val']['auc']:.4f}  Brier {out['val']['brier']:.4f}")
    if "test" in out:
        print(f"             test AUC {out['test']['auc']:.4f}  Brier {out['test']['brier']:.4f}")
    assert 0.55 < out["val"]["auc"] < 0.75, "baseline AUC off expected range"
    print("  ACCEPT: baseline AUC computed and stored.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
