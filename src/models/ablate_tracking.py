"""Per-feature ablation for the six tracking measures wired in for v8.

The NBA API publishes fifteen per-player tracking measures. Nine were already in
the model; six were being pulled, stored and ignored. This decides which of the
six earn a place under the pre-registered rule the existing group ablations
used: keep a feature only if it adds at least +0.001 validation AUC, or
improves validation Brier by a material margin.

Each candidate is measured ALONE against a common baseline that excludes all
six, so the verdicts do not depend on the order they are added in. LightGBM is
the probe for the same reason it was in the group ablation: it is the fastest
family that ranks like the eventual production model.

CLI:  python -m src.models.ablate_tracking
Outputs: reports/TRACKING_ABLATION.md, reports/figures/tracking_ablation.json
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config
from src.dataset import load_processed
from src.models.classical import make_preprocessor
from src.seeds import set_global_seed

CANDIDATES = ["drive_pts", "catch_shoot_pts", "pull_up_pts",
              "dist_miles", "time_of_poss", "paint_touch_fg_pct"]

KEEP_BAR_AUC = 0.001
# a Brier tiebreak must be material. Any negative float satisfies "improves",
# and at this sample size that admits differences of 1e-5, which is the noise
# the pre-registered bar exists to exclude.
KEEP_BAR_BRIER = -0.0005


def _fit_probe(ds, numeric, cfg):
    """One LightGBM on the given numeric columns; returns val AUC and Brier."""
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation

    meta = dict(ds.meta, numeric=numeric)
    pre = make_preprocessor(meta)
    feats = numeric + meta["categorical"]

    Xtr = pre.fit_transform(ds.train[feats]).astype("float32")
    Xva = pre.transform(ds.val_fit[feats]).astype("float32")
    ytr = ds.train[ds.target].values
    yva = ds.val_fit[ds.target].values
    w = ds.weights(ds.train)

    p = cfg.models.lightgbm
    model = LGBMClassifier(
        n_estimators=p.n_estimators, learning_rate=p.learning_rate,
        num_leaves=p.num_leaves, feature_fraction=p.feature_fraction,
        bagging_fraction=p.bagging_fraction, n_jobs=p.n_jobs,
        random_state=cfg.seed, verbose=-1)
    model.fit(Xtr, ytr, sample_weight=w, eval_set=[(Xva, yva)],
              callbacks=[early_stopping(100), log_evaluation(0)])

    Xfull = pre.transform(ds.val[feats]).astype("float32")
    pv = model.predict_proba(Xfull)[:, 1]
    y = ds.val[ds.target].values
    return float(roc_auc_score(y, pv)), float(brier_score_loss(y, pv))


def main() -> int:
    cfg = get_config()
    set_global_seed(cfg.seed)
    ds = load_processed(cfg, with_test=False)

    present = [c for c in CANDIDATES if c in ds.meta["numeric"]]
    missing = [c for c in CANDIDATES if c not in ds.meta["numeric"]]
    if missing:
        print(f"  not in the feature set, skipping: {missing}")

    base_numeric = [c for c in ds.meta["numeric"] if c not in present]
    print(f"Tracking ablation: {len(present)} candidates, "
          f"baseline has {len(base_numeric)} numeric features")

    t0 = time.time()
    base_auc, base_brier = _fit_probe(ds, base_numeric, cfg)
    print(f"  [baseline        ] val AUC {base_auc:.4f}  Brier {base_brier:.4f}"
          f"  ({time.time()-t0:.0f}s)")

    try:
        import mlflow
        mlflow.set_tracking_uri(cfg.path("mlruns").as_uri())
        mlflow.set_experiment("hoopiq_tracking_ablation")
    except Exception as e:  # noqa: BLE001
        print(f"  (mlflow unavailable: {e})")
        mlflow = None

    rows = []
    for feat in present:
        t = time.time()
        auc, brier = _fit_probe(ds, base_numeric + [feat], cfg)
        d_auc, d_brier = auc - base_auc, brier - base_brier
        keep = d_auc >= KEEP_BAR_AUC or d_brier <= KEEP_BAR_BRIER
        rows.append({"feature": feat, "val_auc": auc, "val_brier": brier,
                     "d_auc": d_auc, "d_brier": d_brier, "keep": keep,
                     "seconds": round(time.time() - t, 1)})
        print(f"  [{feat:16}] val AUC {auc:.4f} ({d_auc:+.4f})  "
              f"Brier {brier:.4f} ({d_brier:+.4f})  -> "
              f"{'KEEP' if keep else 'drop'}  ({time.time()-t:.0f}s)")
        if mlflow:
            with mlflow.start_run(run_name=f"add_{feat}"):
                mlflow.log_param("feature", feat)
                mlflow.log_metrics({"val_auc": auc, "val_brier": brier,
                                    "delta_auc": d_auc, "delta_brier": d_brier})

    keep = [r["feature"] for r in rows if r["keep"]]
    out = {"baseline": {"val_auc": base_auc, "val_brier": base_brier,
                        "n_numeric": len(base_numeric)},
           "bar_auc": KEEP_BAR_AUC, "results": rows, "keep": keep,
           "n_train": int(len(ds.train))}
    figs = cfg.path("figures")
    figs.mkdir(parents=True, exist_ok=True)
    (figs / "tracking_ablation.json").write_text(json.dumps(out, indent=2))

    lines = [
        "# TRACKING_ABLATION.md — the six previously unused tracking measures",
        "",
        f"The NBA API publishes fifteen per-player tracking measures. Nine were in the",
        f"model; these six were pulled, stored and never wired in. Each is measured",
        f"ALONE against a common baseline that excludes all six, on the validation",
        f"season, with LightGBM and recency weighting, train n = {len(ds.train):,}.",
        "",
        f"Pre-registered rule: keep if delta val AUC >= +{KEEP_BAR_AUC}, or val Brier "
        f"improves by at least {abs(KEEP_BAR_BRIER)} (a material gain, not a rounding one).",
        "",
        f"Baseline: val AUC **{base_auc:.4f}**, Brier {base_brier:.4f} "
        f"({len(base_numeric)} numeric features).",
        "",
        "| feature | val AUC | delta AUC | val Brier | delta Brier | verdict |",
        "|---|---|---|---|---|---|",
    ]
    for r in sorted(rows, key=lambda x: -x["d_auc"]):
        lines.append(f"| `{r['feature']}` | {r['val_auc']:.4f} | {r['d_auc']:+.4f} | "
                     f"{r['val_brier']:.4f} | {r['d_brier']:+.4f} | "
                     f"{'**KEEP**' if r['keep'] else 'drop'} |")
    lines += ["", f"**Kept: {', '.join(keep) if keep else 'none'}.**", ""]
    if not keep:
        lines.append("No candidate cleared the bar. The nine measures already in the "
                     "model capture what this feed has to say about a shooter; the "
                     "remaining six are volume and points restatements of them.")
    Path(cfg.path("reports") / "TRACKING_ABLATION.md").write_text(
        "\n".join(lines), encoding="utf-8")

    print(f"\n  keep: {keep or 'none'}")
    print(f"  wrote reports/TRACKING_ABLATION.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
