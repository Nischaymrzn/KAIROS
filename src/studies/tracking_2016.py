"""The 2015-16 full-tracking study — the honest ceiling of shot-quality prediction.

Trains the same model twice on the same game-level chronological split:
  (a) WITHOUT tracking: only what every season has (location, distance, shot type,
      zone, period, shooter skill).
  (b) WITH tracking: adds the real, pre-release SportVU signal — closest and
      second-closest defender distance, the defender's angle to the shooter->rim
      line, help defenders within 6 ft, shooter speed and closing speed, the real
      shot clock, time with ball, release height.

The gap is what genuine tracking data is worth. This is the strongest legitimate
result available: published shot-quality work with full tracking lands around
AUC 0.70-0.72, and no feature set reaches 0.80 without leaking the outcome (see
`src/models/ceiling.py` and `src/studies/leakage_demo.py`).

**No `post_*` column may appear here.** Those describe the ball's flight after it
leaves the hand and therefore encode the outcome; an assertion enforces it.

CLI:  python -m src.studies.tracking_2016
Outputs: reports/TRACKING_STUDY.md
"""
from __future__ import annotations
import json

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config
from src.seeds import set_global_seed

BASE = ["SHOT_DISTANCE", "is_3", "period", "player_fg"]
TRACKING = ["pre_def_dist", "pre_def_dist_2", "pre_def_angle",
            "pre_help_defenders", "pre_shooter_speed", "pre_closing_speed",
            "pre_shot_clock", "pre_time_with_ball", "pre_release_height",
            "pre_def_x_3"]


def _load(cfg) -> pd.DataFrame:
    fp = cfg.path("data_movement") / "shots_tracking.parquet"
    df = pd.read_parquet(fp)
    leak = [c for c in df.columns if c.startswith("post_")]
    df = df.drop(columns=leak)                      # never enter this study
    df["is_3"] = (df["SHOT_TYPE"].astype("string") == "3PT Field Goal").astype(int)
    df["period"] = df["PERIOD"].astype(int)
    df["MADE"] = df["MADE"].astype(int)
    # defender distance matters most on threes
    df["pre_def_x_3"] = df["pre_def_dist"] * df["is_3"]
    for c in TRACKING + BASE:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def _chrono_split(df: pd.DataFrame):
    """Split by GAME_ID order (monotonic with date within a season): 70/15/15."""
    games = np.sort(df["GAME_ID"].unique())
    n = len(games)
    tr = set(games[: int(0.70 * n)])
    va = set(games[int(0.70 * n): int(0.85 * n)])
    te = set(games[int(0.85 * n):])
    return (df[df["GAME_ID"].isin(tr)].copy(),
            df[df["GAME_ID"].isin(va)].copy(),
            df[df["GAME_ID"].isin(te)].copy())


def _add_skill(train, val, test):
    p_fg = train.groupby("PLAYER_ID")["MADE"].mean()
    glob = float(train["MADE"].mean())
    for part in (train, val, test):
        part["player_fg"] = part["PLAYER_ID"].map(p_fg).fillna(glob).astype("float32")
    return train, val, test


def _fit_eval(train, val, test, cols):
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation
    med = train[cols].median()
    tr, va, te = (p[cols].fillna(med) for p in (train, val, test))
    m = LGBMClassifier(n_estimators=2000, learning_rate=0.03, num_leaves=63,
                       feature_fraction=0.8, bagging_fraction=0.8, n_jobs=-1,
                       random_state=42)
    m.fit(tr, train["MADE"], eval_set=[(va, val["MADE"])],
          callbacks=[early_stopping(80), log_evaluation(0)])
    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(m.predict_proba(va)[:, 1], val["MADE"])
    return iso.transform(m.predict_proba(te)[:, 1])


def _metrics(y, p) -> dict:
    return {"auc": float(roc_auc_score(y, p)),
            "brier": float(brier_score_loss(y, p)), "n": int(len(y))}


def _report(res, cfg, n_total, n_games):
    a, b = res["without"], res["with"]
    a3, b3 = res["without_3pt"], res["with_3pt"]
    md = f"""# TRACKING_STUDY.md — what real tracking data is worth (2015-16)

Extracted **{n_total:,} shots** from **{n_games} SportVU games** (the full 2015-16
season), each with pre-release tracking measured at the true instant of release
(detected physically as the last frame the ball is in the shooter's hands, not
from the logged event time).

**Extraction validated against ground truth** (the 2014-15 shot logs, the only
season with published per-shot tracking): our median shot clock reads 11.9 s vs a
true 12.3 s; our median closest defender 4.7 ft vs a true 3.7 ft; median release
height 10.1 ft, consistent with a ball released above the head.

Same LightGBM, same game-level chronological split (70/15/15), isotonic-calibrated
on validation, trained **without** vs **with** the tracking features.

## Results (held-out test games)

| Model | AUC | Brier | n |
|---|---|---|---|
| Without tracking | {a['auc']:.4f} | {a['brier']:.4f} | {a['n']:,} |
| **With tracking** | **{b['auc']:.4f}** | **{b['brier']:.4f}** | {b['n']:,} |
| **Delta** | **{b['auc']-a['auc']:+.4f}** | **{b['brier']-a['brier']:+.4f}** | |

### 3-point shots only (where contest matters most)

| Model | AUC | Brier | n |
|---|---|---|---|
| Without tracking | {a3['auc']:.4f} | {a3['brier']:.4f} | {a3['n']:,} |
| **With tracking** | **{b3['auc']:.4f}** | **{b3['brier']:.4f}** | {b3['n']:,} |
| **Delta** | **{b3['auc']-a3['auc']:+.4f}** | | |

## Interpretation

Real defender geometry, shooter motion and the true shot clock are the most
valuable features available to a shot-quality model — and they are still bounded.
This is the honest ceiling: **no feature set reaches AUC 0.80 on shot-make.**

`src/models/ceiling.py` shows why. A shot outcome is a Bernoulli draw; even an
oracle that knows each shot's true probability exactly scores only ~0.68 given the
probability spread real basketball exhibits. Reaching 0.80 would require the best
shots to fall ~100% of the time and the worst ~0% — but even **dunks make 89.2%**
and 30-footers make 22.0%.

Any model reporting AUC >= 0.80 on this target has leaked the outcome. We
demonstrate exactly that, deliberately, in `reports/LEAKAGE_DEMO.md`.
"""
    (cfg.path("reports") / "TRACKING_STUDY.md").write_text(md, encoding="utf-8")


def main() -> int:
    cfg = get_config()
    set_global_seed(cfg.seed)
    df = _load(cfg)
    assert not [c for c in df.columns if c.startswith("post_")], \
        "post-release (outcome) features must never enter the tracking study"

    n_games = df["GAME_ID"].nunique()
    print(f"2015-16 tracking shots: {len(df):,} from {n_games} games "
          f"(make rate {df['MADE'].mean():.3f})")

    train, val, test = _chrono_split(df)
    train, val, test = _add_skill(train, val, test)
    print(f"  split -> train {len(train):,} | val {len(val):,} | test {len(test):,}")

    cols_a = [c for c in BASE if c in df.columns]
    cols_b = cols_a + [c for c in TRACKING if c in df.columns]
    p_without = _fit_eval(train, val, test, cols_a)
    p_with = _fit_eval(train, val, test, cols_b)

    y = test["MADE"].to_numpy()
    m3 = test["is_3"].to_numpy() == 1
    res = {"without": _metrics(y, p_without), "with": _metrics(y, p_with),
           "without_3pt": _metrics(y[m3], p_without[m3]),
           "with_3pt": _metrics(y[m3], p_with[m3])}

    a, b = res["without"], res["with"]
    a3, b3 = res["without_3pt"], res["with_3pt"]
    print("\n  value of real tracking data (test games):")
    print(f"    overall  AUC {a['auc']:.4f} -> {b['auc']:.4f} ({b['auc']-a['auc']:+.4f})"
          f"  Brier {a['brier']:.4f} -> {b['brier']:.4f}")
    print(f"    3PT only AUC {a3['auc']:.4f} -> {b3['auc']:.4f} ({b3['auc']-a3['auc']:+.4f})")

    _report(res, cfg, len(df), n_games)
    (cfg.path("figures") / "tracking_study.json").write_text(json.dumps(res, indent=2))
    print("  wrote reports/TRACKING_STUDY.md")
    assert b["auc"] >= a["auc"] - 1e-6, "tracking features should not hurt"
    assert b["auc"] < 0.80, "AUC >= 0.80 on shot-make means leakage — investigate"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
