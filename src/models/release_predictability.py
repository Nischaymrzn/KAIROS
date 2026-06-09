"""Is the ball's flight predictable from anything knowable BEFORE release?

This is the most direct evidence in the project that the residual variance in shot
outcomes is **execution**, not missing situational features — and therefore that the
~0.70 ceiling is a property of the target rather than a modelling failure.

**The argument it settles.** A basketball shot is Newtonian, not random: given the
exact release velocity, angle and spin, the outcome is determined. A natural
objection to the ceiling result is therefore "the shot depends on the release, so
predict the release". This module tests that directly.

For each post-release quantity we regress it on **everything the model could know at
or before release** — defender distance, second defender, defender angle, help
defenders, shooter speed, closing speed, real shot clock, time with ball, release
height, shot distance, period — and report out-of-sample R².

**Measured on all 84,257 tracked shots (2015-16 SportVU):**

    post_apex_height    R^2 0.612   predictable
    post_flight_time    R^2 0.561   predictable
    post_min_rim_dist   R^2 0.363   weakly predictable
    post_entry_angle    R^2 0.046   essentially unpredictable

The split is the finding. The two predictable quantities are **geometric
consequences of distance** — a 26-footer must travel higher and hang longer — and
say nothing about whether the ball goes in. The two that decide the outcome are the
two that cannot be recovered: `post_min_rim_dist` (how close the ball passed to the
rim centre — essentially the outcome itself) leaves ~64% of its variance
unexplained, and `post_entry_angle` leaves ~95%.

**Conclusion.** Pre-release information determines the *envelope* of a shot, not its
*accuracy*. So a "predicted release" feature cannot help: quite apart from being a
deterministic function of inputs the model already has (and therefore redundant to a
flexible learner), the information simply is not present to be extracted.

This also explains why published computer-vision models report 80-95% "shot
prediction" accuracy. They observe the release — via pose estimation — or the ball in
flight. Those are measurements of exactly the quantities shown here to be
unrecoverable beforehand. See `reports/LEAKAGE_DEMO.md`: adding ball arc and entry
angle moves the same data from AUC 0.6456 to 0.8131.

**No model here is ever served.** `post_*` columns are outcome-bearing by
construction and are guarded out of production by
`tests/test_no_leakage.py::test_no_post_release_features_in_production_model`.

CLI:  python -m src.models.release_predictability
Output: reports/figures/release_predictability.json, reports/RELEASE_PREDICTABILITY.md
"""
from __future__ import annotations
import json

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score

from src.config import get_config
from src.seeds import set_global_seed

CONTEXT = ["SHOT_DISTANCE", "PERIOD"]
TARGETS = {
    "post_apex_height": "how high the ball went",
    "post_flight_time": "how long it was in the air",
    "post_min_rim_dist": "closest approach to the rim centre (~the outcome)",
    "post_entry_angle": "the angle it came down at",
}
DECIDES_OUTCOME = {"post_min_rim_dist", "post_entry_angle"}


def _fit_r2(X, y, seed: int) -> float:
    from lightgbm import LGBMRegressor
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=seed)
    m = LGBMRegressor(n_estimators=400, learning_rate=0.05, num_leaves=63,
                      random_state=seed, verbose=-1).fit(Xtr, ytr)
    return float(r2_score(yte, m.predict(Xte)))


def main() -> int:
    cfg = get_config()
    set_global_seed(cfg.seed)
    fp = cfg.path("data_movement") / "shots_tracking.parquet"
    if not fp.exists():
        print(f"{fp} missing — run `make tracking-extract` first")
        return 1
    df = pd.read_parquet(fp)
    pre = [c for c in df.columns if c.startswith("pre_")]
    feats = CONTEXT + pre

    X = df[feats].apply(pd.to_numeric, errors="coerce")
    X = X.replace([np.inf, -np.inf], np.nan)
    X = X.fillna(X.median())

    print(f"n = {len(df):,} tracked shots (2015-16)")
    print(f"predictors ({len(feats)}): {feats}\n")
    print(f"{'post-release quantity':22}{'R^2':>8}   {'verdict':26}what it is")

    rows = []
    for t, desc in TARGETS.items():
        if t not in df.columns:
            continue
        y = pd.to_numeric(df[t], errors="coerce").replace([np.inf, -np.inf], np.nan)
        ok = y.notna()
        lo, hi = y[ok].quantile([0.01, 0.99])      # trim extraction outliers
        ok &= y.between(lo, hi)
        r2 = _fit_r2(X[ok], y[ok], cfg.seed)
        verdict = ("essentially unpredictable" if r2 < 0.15
                   else "weakly predictable" if r2 < 0.40 else "predictable")
        rows.append({"target": t, "r2": r2, "verdict": verdict,
                     "decides_outcome": t in DECIDES_OUTCOME,
                     "description": desc, "n": int(ok.sum())})
        print(f"{t:22}{r2:>8.3f}   {verdict:26}{desc}")

    outcome_r2 = [r["r2"] for r in rows if r["decides_outcome"]]
    envelope_r2 = [r["r2"] for r in rows if not r["decides_outcome"]]
    out = {
        "n_shots": int(len(df)), "predictors": feats, "results": rows,
        "mean_r2_outcome_deciding": float(np.mean(outcome_r2)) if outcome_r2 else None,
        "mean_r2_envelope": float(np.mean(envelope_r2)) if envelope_r2 else None,
        "conclusion": ("Pre-release information determines the ENVELOPE of a shot "
                       "(how far, how long) but not its ACCURACY (how close to the "
                       "rim, at what angle). The residual is execution, not missing "
                       "situational features."),
    }
    print(f"\n  mean R^2, envelope quantities        : {out['mean_r2_envelope']:.3f}")
    print(f"  mean R^2, outcome-deciding quantities: {out['mean_r2_outcome_deciding']:.3f}")
    print("\n  " + out["conclusion"])

    md = ["# RELEASE_PREDICTABILITY.md — can the ball flight be known in advance?", "",
          "Out-of-sample R² predicting each post-release quantity from **everything",
          f"knowable at or before release**, on {len(df):,} tracked shots (2015-16 SportVU).", "",
          "| post-release quantity | what it is | R² | decides the outcome? |",
          "|---|---|---|---|"]
    for r in sorted(rows, key=lambda r: -r["r2"]):
        md.append(f"| `{r['target']}` | {r['description']} | **{r['r2']:.3f}** | "
                  f"{'**yes**' if r['decides_outcome'] else 'no'} |")
    md += ["", "## Reading", "",
           "The predictable quantities are geometric consequences of shot distance — a",
           "longer shot must travel higher and hang longer — and carry no information",
           "about whether the ball goes in. **The two quantities that decide the outcome",
           "are the two that cannot be recovered from pre-release data.**", "",
           "So a 'predicted release' feature cannot rescue a pre-release model: the",
           "information is not present to extract. This is the direct empirical answer to",
           "the objection that a basketball shot is deterministic physics rather than a",
           "coin flip. It *is* deterministic — but the determining variables are created",
           "at release and are invisible beforehand.", "",
           "It also explains published computer-vision results reporting 80-95% 'shot",
           "prediction' accuracy: those systems observe the release (pose estimation) or",
           "the ball in flight. They measure precisely the quantities shown here to be",
           "unrecoverable in advance — see `reports/LEAKAGE_DEMO.md`, where adding ball",
           "arc and entry angle moves the same data from AUC 0.6456 to 0.8131.", ""]
    (cfg.path("reports") / "RELEASE_PREDICTABILITY.md").write_text(
        "\n".join(md), encoding="utf-8")
    (cfg.path("figures") / "release_predictability.json").write_text(
        json.dumps(out, indent=2))
    print("\n  wrote reports/RELEASE_PREDICTABILITY.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
