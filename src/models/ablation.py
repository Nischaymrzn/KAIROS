"""Feature-group ablation: what is each enrichment actually worth?

Trains the production model family on the full feature set, then again with one
group removed at a time. The drop in validation AUC/Brier is that group's
isolated contribution. Same data, same split, same params — so the comparison is
clean and cheap (no feature rebuild per run).

Keep rule (pre-registered): a group is retained if it adds >= 0.001 val AUC or
improves val Brier. Otherwise it is dropped and the null result documented.

CLI:  python -m src.models.ablation
Outputs: reports/figures/ablation.json
"""
from __future__ import annotations
import json

from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config
from src.seeds import set_global_seed
from src.dataset import load_processed
from src.models.classical import make_preprocessor

from src.features.groups import FEATURE_GROUPS

# human-readable labels for the shared group definitions
LABELS = {
    "possession": "possession (shot clock, transition)",
    "rhythm": "rhythm (hot hand)",
    "rest": "rest / fatigue",
    "combine": "combine athleticism",
    "game_state": "score margin / home / opponent",
}
GROUPS = {LABELS.get(k, k): v for k, v in FEATURE_GROUPS.items()}


def _fit_eval(ds, num, cat, cfg):
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation
    meta = {"numeric": num, "categorical": cat}
    pre = make_preprocessor(meta)
    Xtr = pre.fit_transform(ds.train[num + cat]).astype("float32")
    Xva = pre.transform(ds.val[num + cat]).astype("float32")
    ytr, yva = ds.train["MADE"].to_numpy(), ds.val["MADE"].to_numpy()
    p = cfg.models.lightgbm
    m = LGBMClassifier(n_estimators=p.n_estimators, learning_rate=p.learning_rate,
                       num_leaves=p.num_leaves, feature_fraction=p.feature_fraction,
                       bagging_fraction=p.bagging_fraction, n_jobs=p.n_jobs,
                       random_state=cfg.seed)
    m.fit(Xtr, ytr, eval_set=[(Xva, yva)],
          callbacks=[early_stopping(80), log_evaluation(0)])
    pv = m.predict_proba(Xva)[:, 1]
    return roc_auc_score(yva, pv), brier_score_loss(yva, pv)


def main() -> int:
    cfg = get_config()
    set_global_seed(cfg.seed)
    ds = load_processed(cfg, with_test=False)
    num, cat = list(ds.meta["numeric"]), list(ds.meta["categorical"])

    full_auc, full_brier = _fit_eval(ds, num, cat, cfg)
    print(f"FULL model: val AUC {full_auc:.4f}  Brier {full_brier:.4f}  "
          f"({len(num)} numeric + {len(cat)} categorical)\n")
    print(f"{'group removed':<38} {'AUC':>8} {'dAUC':>9} {'Brier':>8} {'dBrier':>9}  keep?")

    rows = [{"group": "FULL", "val_auc": round(full_auc, 5),
             "val_brier": round(full_brier, 5)}]
    for name, cols in GROUPS.items():
        n2 = [c for c in num if c not in cols]
        c2 = [c for c in cat if c not in cols]
        if len(n2) + len(c2) == len(num) + len(cat):
            print(f"  {name:<36} (no columns present, skipped)")
            continue
        auc, brier = _fit_eval(ds, n2, c2, cfg)
        d_auc = full_auc - auc          # positive => group helps AUC
        d_brier = brier - full_brier    # positive => group helps Brier
        keep = "KEEP" if (d_auc >= 0.001 or d_brier > 0) else "drop"
        print(f"{name:<38} {auc:8.4f} {d_auc:+9.4f} {brier:8.4f} {d_brier:+9.4f}  {keep}")
        rows.append({"group": name, "val_auc": round(auc, 5),
                     "val_brier": round(brier, 5),
                     "contribution_auc": round(float(d_auc), 5),
                     "contribution_brier": round(float(d_brier), 5),
                     "verdict": keep})

    out = cfg.path("figures") / "ablation.json"
    out.write_text(json.dumps(rows, indent=2))
    print(f"\n  wrote {out}")
    print("  (contribution = full model minus the model without that group)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
