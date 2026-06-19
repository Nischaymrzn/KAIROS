"""LEAKAGE DEMONSTRATION — a deliberately broken model. NEVER ship this.

This is a **negative control**. It exists to show, with real data, what target
leakage looks like and why a high AUC on shot-make prediction is a red flag rather
than an achievement.

We train the same model on the same 2015-16 shots three ways:

  1. HONEST      pre-release features only (defender geometry, shooter motion,
                 real shot clock). This is the legitimate model.
  2. SUBTLE LEAK add the ball's flight *shape*: apex height, entry angle at the
                 rim, closest approach to the rim. Nothing here says "made" — and
                 yet AUC leaps. This is the mistake a careful student actually
                 makes, because arc and entry angle sound like shot-quality.
  3. BLATANT LEAK add `post_through_hoop` — whether the ball passed down through
                 the cylinder. This *is* the outcome, wearing a feature's clothes.

Why the leaky models are worthless despite their AUC:
  * They answer "did this ball go in?", not "is this a good shot to take?".
  * Every input is generated AFTER the ball leaves the hand. You cannot know the
    entry angle before the player shoots, so the dashboard can never call them.
  * Optimising a decision-support tool on them would be meaningless.

This is the same class of error we caught twice in this project's real pipeline:
a play-by-play join that matched a made shot's own scoring event (validation AUC
jumped to 0.70), and the risk that a shot's own event became its "previous event".

CLI:  python -m src.studies.leakage_demo
Outputs: reports/LEAKAGE_DEMO.md
"""
from __future__ import annotations
import json

import pandas as pd
from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config
from src.seeds import set_global_seed
from src.studies.tracking_2016 import _chrono_split, _add_skill, BASE, TRACKING

SUBTLE_LEAK = ["post_apex_height", "post_entry_angle", "post_min_rim_dist",
               "post_flight_time", "post_z_at_rim"]
BLATANT_LEAK = ["post_through_hoop"]


def _load(cfg) -> pd.DataFrame:
    df = pd.read_parquet(cfg.path("data_movement") / "shots_tracking.parquet")
    df["is_3"] = (df["SHOT_TYPE"].astype("string") == "3PT Field Goal").astype(int)
    df["period"] = df["PERIOD"].astype(int)
    df["MADE"] = df["MADE"].astype(int)
    df["pre_def_x_3"] = df["pre_def_dist"] * df["is_3"]
    return df


def _fit_eval(train, val, test, cols):
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation
    med = train[cols].median()
    tr, va, te = (p[cols].fillna(med) for p in (train, val, test))
    m = LGBMClassifier(n_estimators=2000, learning_rate=0.03, num_leaves=63,
                       feature_fraction=0.8, bagging_fraction=0.8, n_jobs=-1,
                       random_state=42)
    m.fit(tr, train["MADE"], eval_set=[(va, val["MADE"])],
          callbacks=[early_stopping(80), log_evaluation(0)])
    p = m.predict_proba(te)[:, 1]
    return (float(roc_auc_score(test["MADE"], p)),
            float(brier_score_loss(test["MADE"], p)))


def main() -> int:
    cfg = get_config()
    set_global_seed(cfg.seed)
    df = _load(cfg)
    train, val, test = _chrono_split(df)
    train, val, test = _add_skill(train, val, test)

    base = [c for c in BASE if c in df.columns]
    honest = base + [c for c in TRACKING if c in df.columns]
    subtle = honest + [c for c in SUBTLE_LEAK if c in df.columns]
    blatant = subtle + [c for c in BLATANT_LEAK if c in df.columns]

    runs = [
        ("1. HONEST (pre-release only)", honest, "legitimate"),
        ("2. SUBTLE LEAK (+ ball arc, entry angle)", subtle, "INVALID"),
        ("3. BLATANT LEAK (+ ball through hoop)", blatant, "INVALID"),
    ]
    print(f"2015-16 shots {len(df):,} | test games {test['GAME_ID'].nunique()}\n")
    print(f"{'model':<44} {'test AUC':>9} {'Brier':>8}  verdict")
    rows = []
    for name, cols, verdict in runs:
        auc, brier = _fit_eval(train, val, test, cols)
        print(f"{name:<44} {auc:>9.4f} {brier:>8.4f}  {verdict}")
        rows.append({"model": name, "test_auc": round(auc, 4),
                     "test_brier": round(brier, 4), "verdict": verdict,
                     "n_features": len(cols)})

    honest_auc = rows[0]["test_auc"]
    subtle_auc = rows[1]["test_auc"]
    blatant_auc = rows[2]["test_auc"]

    md = f"""# LEAKAGE_DEMO.md — how to get AUC 0.90, and why it is worthless

> **This model is a negative control. It is deliberately broken and is never
> served.** It exists to show what target leakage looks like on real data.

Same 2015-16 SportVU shots, same LightGBM, same game-level chronological split.
The only difference is which features the model is allowed to see.

| Model | Features | Test AUC | Brier | Verdict |
|---|---|---|---|---|
| 1. Honest (pre-release only) | {rows[0]['n_features']} | **{honest_auc:.4f}** | {rows[0]['test_brier']:.4f} | legitimate |
| 2. Subtle leak (+ ball arc, entry angle) | {rows[1]['n_features']} | {subtle_auc:.4f} | {rows[1]['test_brier']:.4f} | **INVALID** |
| 3. Blatant leak (+ ball through hoop) | {rows[2]['n_features']} | {blatant_auc:.4f} | {rows[2]['test_brier']:.4f} | **INVALID** |

Adding the ball's flight lifts AUC by **{subtle_auc - honest_auc:+.4f}** —
from {honest_auc:.3f} to {subtle_auc:.3f} — without a single feature that names the
outcome. Adding whether the ball fell through the hoop takes it to
**{blatant_auc:.3f}**.

## Why these numbers are meaningless

Every leaked feature is generated **after the ball leaves the shooter's hand**.
The ball's apex, its entry angle at the rim, how near it passed to the rim centre
— these are *consequences* of the shot, not properties of the decision to take it.

1. **They answer the wrong question.** "Did this ball go in?" is not "is this a
   good shot?". A model that needs to watch the ball land has predicted nothing.
2. **They cannot be served.** The dashboard scores a shot *before* it is taken.
   Release velocity and entry angle do not exist at that moment. The leaky model
   literally cannot be called.
3. **They destroy the decision.** Optimising shot selection against a model that
   already knows the ball's trajectory is circular.

## The honest boundary

A shot-quality feature must be knowable **at or before the instant of release**
and must not encode the ball's flight. Defender geometry, shooter speed, shot
clock, location and shooter identity all pass. Ball kinematics after release do
not. Release height sits on the boundary — it is a property of the shooter rather
than of the ball's fate — so it is included and ablated separately.

## This is not hypothetical

We hit this class of error twice in this project's *real* pipeline:

* A play-by-play join matched a made shot's **own scoring event**, so the score
  margin already contained the basket. Validation AUC jumped to 0.70 and
  `corr(score_margin, MADE)` hit **+0.10**. Fixed with
  `allow_exact_matches=False`; the correlation fell to **+0.0014**.
* The same join risked making a shot's own made/missed event its "previous event".
  Checked: `corr(prev_event=="made", MADE) = -0.017` — a self-leak would have
  spiked it.

Both are guarded by `tests/test_no_leakage.py`.

## The takeaway

The honest model scores **{honest_auc:.4f}**, which `src/models/ceiling.py` shows is
within a few thousandths of the theoretical maximum for this target — because shot
outcomes are Bernoulli draws, and even **dunks only make 89.2%**.

**If a shot-make model reports AUC >= 0.80, look for the leak.** It is there.
"""
    (cfg.path("reports") / "LEAKAGE_DEMO.md").write_text(md, encoding="utf-8")
    (cfg.path("figures") / "leakage_demo.json").write_text(json.dumps(rows, indent=2))
    print("\n  wrote reports/LEAKAGE_DEMO.md")
    print(f"  honest {honest_auc:.4f} -> subtle leak {subtle_auc:.4f} "
          f"-> blatant leak {blatant_auc:.4f}")
    assert subtle_auc > honest_auc, "the leak should inflate AUC — else check extraction"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
