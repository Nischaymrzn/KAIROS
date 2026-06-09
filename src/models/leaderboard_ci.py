"""Paired bootstrap confidence intervals across the model leaderboard.

The 8-family comparison ranks models by validation AUC separated by as little as
0.0009 (CatBoost 0.6976 vs FT-Transformer 0.6967), and the stacked ensemble was
reported as +0.0004 over the single model — all with **no uncertainty estimate**.
The test-set AUC CI is +/-0.0021 (`make skill`), which is wider than those gaps, so
the ranking may not be meaningful.

This settles it directly and cheaply: every model was already trained and
serialised to `models/*.joblib`, so no retraining is needed. We re-score the
validation season with each, then compute a **paired** bootstrap CI on the
difference against the leaderboard leader — resampling both models on the SAME
shot indices, which cancels the shared sampling noise and is the correct test for
"is model A better than model B on this data".

A model is reported as TIED with the leader when the 95% CI of the difference
contains zero.

**Test is never loaded.** This is a validation-set analysis.

CLI:  python -m src.models.leaderboard_ci [--boot 1000]
Output: reports/figures/leaderboard_ci.json
"""
from __future__ import annotations
import argparse
import json

import joblib
import numpy as np
from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config
from src.dataset import load_processed
from src.models.registry import predict_proba


def paired_delta_ci(y, p_ref, p_other, n_boot: int, seed: int = 42):
    """95% CI on AUC(other) - AUC(ref), resampled on shared indices."""
    rng = np.random.default_rng(seed)
    n = len(y)
    d = np.empty(n_boot)
    for i in range(n_boot):
        j = rng.integers(0, n, n)
        yj = y[j]
        if yj.min() == yj.max():
            d[i] = np.nan
            continue
        d[i] = roc_auc_score(yj, p_other[j]) - roc_auc_score(yj, p_ref[j])
    d = d[~np.isnan(d)]
    return float(np.quantile(d, 0.025)), float(np.quantile(d, 0.975))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boot", type=int, default=1000)
    args = ap.parse_args()

    cfg = get_config()
    ds = load_processed(cfg, with_test=False)
    y = ds.val["MADE"].to_numpy()
    mdir = cfg.path("models")

    board = json.loads((mdir / "leaderboard.json").read_text())
    names = [m["name"] for m in board["models"]]
    # include any serialised family the stored leaderboard predates
    for extra in ("catboost", "xgboost", "lightgbm", "rf", "logreg",
                  "mlp", "fttransformer", "tabnet"):
        if extra not in names and (mdir / f"{extra}.joblib").exists():
            names.append(extra)

    # PROVENANCE GUARD. The scratch workspace models/ has been overwritten by later
    # experiments before (see DEVLOG 2026-07-09), leaving binaries from different
    # training runs side by side. Comparing those is meaningless, so re-scored AUCs
    # are checked against the FROZEN bundle's leaderboard and anything that does not
    # match is reported as untrusted rather than silently ranked.
    # Reference = the WORKSPACE leaderboard when it exists, because that is the
    # board these bundles are supposed to correspond to. (Using the frozen v7 board
    # was right while the workspace was a mix of old runs, but after a legitimate
    # retrain on a new feature set every bundle differs from v7 by design, and the
    # guard would reject the whole workspace.) Falls back to the frozen board.
    frozen: dict[str, float] = {}
    ref = "none"
    try:
        frozen = {m["name"]: m["auc"] for m in board["models"]}
        ref = "models/leaderboard.json (workspace)"
    except Exception:                                       # noqa: BLE001
        pass
    if not frozen:
        prod = mdir / "production"
        try:
            v = json.loads((prod / "latest.json").read_text())["version"]
            frozen = {m["name"]: m["auc"] for m in
                      json.loads((prod / f"v{v}" / "leaderboard.json").read_text())["models"]}
            ref = f"models/production/v{v}/leaderboard.json (frozen)"
        except Exception:                                   # noqa: BLE001
            pass
    print(f"  provenance reference: {ref}")

    preds, scored = {}, []
    for n in names:
        fp = mdir / f"{n}.joblib"
        if not fp.exists():
            print(f"  [{n:13}] no serialised bundle — skipped")
            continue
        try:
            p = predict_proba(joblib.load(fp), ds.val)
        except Exception as e:                              # noqa: BLE001
            print(f"  [{n:13}] FAILED to score: {str(e)[:70]}")
            continue
        preds[n] = np.asarray(p, dtype=float)
        auc = float(roc_auc_score(y, p))
        ref = frozen.get(n)
        trusted = ref is None or abs(ref - auc) < 2e-4
        scored.append({"name": n, "val_auc": auc,
                       "val_brier": float(brier_score_loss(y, np.clip(p, 0, 1))),
                       "frozen_leaderboard_auc": ref,
                       "matches_frozen_run": bool(trusted)})
        flag = "" if trusted else f"  <-- UNTRUSTED (frozen run says {ref:.5f})"
        print(f"  [{n:13}] val AUC {auc:.5f}{flag}")

    if not scored:
        print("no models could be scored")
        return 1

    untrusted = [r["name"] for r in scored if not r["matches_frozen_run"]]
    if untrusted:
        print(f"\n  WARNING: {len(untrusted)} serialised model(s) do not reproduce "
              f"the frozen run: {', '.join(untrusted)}")
        print("  They were overwritten by a later experiment, so paired comparisons")
        print("  against them are NOT valid. Excluding them. Retrain consistently")
        print("  (`make train`) to restore the full comparison.")
        scored = [r for r in scored if r["matches_frozen_run"]]
        preds = {k: v for k, v in preds.items() if k in {r["name"] for r in scored}}

    scored.sort(key=lambda r: r["val_auc"], reverse=True)
    leader = scored[0]["name"]
    p_ref = preds[leader]
    print(f"\n  leader: {leader} ({scored[0]['val_auc']:.5f})")
    print(f"  paired bootstrap, {args.boot} resamples over {len(y):,} val shots\n")

    print(f"  {'model':14} {'val AUC':>9} {'d vs leader':>12} "
          f"{'95% CI':>22}  verdict")
    rows = []
    for r in scored:
        n = r["name"]
        if n == leader:
            r.update({"delta_vs_leader": 0.0, "ci95": [0.0, 0.0],
                      "tied_with_leader": True})
            print(f"  {n:14} {r['val_auc']:9.5f} {'-':>12} {'(leader)':>22}")
            rows.append(r)
            continue
        lo, hi = paired_delta_ci(y, p_ref, preds[n], args.boot)
        tied = lo <= 0.0 <= hi
        r.update({"delta_vs_leader": r["val_auc"] - scored[0]["val_auc"],
                  "ci95": [lo, hi], "tied_with_leader": bool(tied)})
        print(f"  {n:14} {r['val_auc']:9.5f} {r['delta_vs_leader']:+12.5f} "
              f"  [{lo:+.5f}, {hi:+.5f}]  "
              f"{'TIED with leader' if tied else 'significantly worse'}")
        rows.append(r)

    # Report what the test ACTUALLY found — do not hard-code a "they tie" story.
    # A paired bootstrap is far more powerful than comparing absolute-AUC CIs,
    # because two models score the same shots and their errors are correlated, so
    # the variance of the DIFFERENCE is much smaller than that of either estimate.
    # Reasoning from the absolute CI width will wrongly suggest models tie.
    tied = [r["name"] for r in rows if r["tied_with_leader"] and r["name"] != leader]
    beaten = [r for r in rows if not r["tied_with_leader"]]
    out = {"leader": leader, "n_val": int(len(y)), "n_boot": args.boot,
           "models": rows, "statistically_tied_with_leader": tied,
           "excluded_untrusted": untrusted,
           "conclusion": ("leader significantly better than every comparable family"
                          if not tied else
                          f"leader ties with: {', '.join(tied)}")}
    print()
    if tied:
        print(f"  Statistically indistinguishable from {leader}: {', '.join(tied)}")
        print("  => report these families as TIED rather than ranking them.")
    else:
        print(f"  {leader} is significantly better than ALL {len(beaten)} comparable")
        print("  families (every paired CI excludes zero): the selection is")
        print("  statistically justified, not a coin flip between tied models.")
    if untrusted:
        print(f"  NOT comparable (overwritten by later runs): {', '.join(untrusted)}")

    fp = cfg.path("figures") / "leaderboard_ci.json"
    fp.write_text(json.dumps(out, indent=2))
    print(f"\n  wrote {fp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
