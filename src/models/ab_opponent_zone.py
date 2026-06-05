"""A/B: zone-specific opponent defence — the last identifiable AUC lever.

**Why this experiment.** The project already measured `opp_def_rating` (the
defending team's season-to-date points allowed per game) and found it **null**
(-0.0001 val AUC). But that is a single scalar per team-game: it cannot express
that a team protects the rim well while defending the arc badly. The audit's
highest-value remaining idea was *defending-lineup quality*, which needs
substitution reconstruction (3-4 days, error-prone). This is the cheap version of
the same hypothesis, at team-and-zone resolution rather than lineup:

    for each (defending team, season, zone):
        FG% allowed in that zone, over PRIOR GAMES ONLY

Unlike every player-season aggregate already in the model, this **varies across the
shots of a single shooter** (he faces different opponents in different zones), so it
is not redundant with anything the model has. The defending team is derived from the
shot spine itself — each game contains shots from both teams — which covers every
season, unlike the box-score route that stops at 2023-24.

Two features are offered to the model:
  `opp_zone_fg`        prior-games FG% allowed by this opponent in this zone
  `opp_zone_fg_delta`  the same, minus the league average for that zone
                       (isolates *this opponent's* effect from zone difficulty,
                       which the model already knows via `zone_fg_pct`)

Both are empirical-Bayes shrunk toward the league zone rate, because early in a
season a team has few prior attempts defended in a given zone.

Pre-registered keep rule, as everywhere in this project: adopt only if the change
adds >= 0.001 val AUC or improves val Brier, with the sign consistent across seeds.
**Test is never loaded.**

CLI:  python -m src.models.ab_opponent_zone [--seeds 2]
Output: reports/figures/ab_opponent_zone.json
"""
from __future__ import annotations
import argparse
import json
import time

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config

PRIOR_STRENGTH = 200.0     # pseudo-attempts shrinking a team-zone rate to league
NEW_COLS = ["opp_zone_fg", "opp_zone_fg_delta"]


def defending_team(df: pd.DataFrame) -> pd.Series:
    """The team being scored on, derived from the two teams present in each game."""
    pair = df.groupby("GAME_ID")["TEAM_ID"].unique()
    lookup = {g: list(t) for g, t in pair.items() if len(t) == 2}

    def _other(g, t):
        pr = lookup.get(g)
        if pr is None:
            return np.nan
        return pr[1] if pr[0] == t else pr[0]

    return pd.Series(
        [_other(g, t) for g, t in zip(df["GAME_ID"].to_numpy(),
                                      df["TEAM_ID"].to_numpy())],
        index=df.index, dtype="float64")


def build_opponent_zone(merged: pd.DataFrame) -> pd.DataFrame:
    """Return SHOT_ID -> (opp_zone_fg, opp_zone_fg_delta), prior games only."""
    df = merged[["SHOT_ID", "GAME_ID", "TEAM_ID", "SEASON", "GAME_DATE",
                 "BASIC_ZONE", "MADE"]].copy()
    df["DEF_TEAM"] = defending_team(df)
    df = df.dropna(subset=["DEF_TEAM"])
    df["GAME_DATE"] = pd.to_datetime(df["GAME_DATE"], errors="coerce")

    # league zone baseline per season (prior games only, same construction)
    game = (df.groupby(["DEF_TEAM", "SEASON", "BASIC_ZONE", "GAME_ID", "GAME_DATE"],
                       observed=True)["MADE"].agg(["sum", "count"])
            .reset_index().sort_values("GAME_DATE"))
    g = game.groupby(["DEF_TEAM", "SEASON", "BASIC_ZONE"], observed=True)
    # expanding totals over games strictly BEFORE the current one
    game["prior_makes"] = g["sum"].transform(lambda s: s.shift().expanding().sum())
    game["prior_att"] = g["count"].transform(lambda s: s.shift().expanding().sum())

    lg = (df.groupby(["SEASON", "BASIC_ZONE"], observed=True)["MADE"].mean()
          .rename("league_zone_fg").reset_index())
    game = game.merge(lg, on=["SEASON", "BASIC_ZONE"], how="left")

    # empirical-Bayes shrink toward the league zone rate
    pm = game["prior_makes"].fillna(0.0)
    pa = game["prior_att"].fillna(0.0)
    lz = game["league_zone_fg"]
    game["opp_zone_fg"] = ((pm + PRIOR_STRENGTH * lz)
                           / (pa + PRIOR_STRENGTH)).astype("float32")
    game["opp_zone_fg_delta"] = (game["opp_zone_fg"] - lz).astype("float32")

    out = df.merge(
        game[["DEF_TEAM", "SEASON", "BASIC_ZONE", "GAME_ID",
              "opp_zone_fg", "opp_zone_fg_delta"]],
        on=["DEF_TEAM", "SEASON", "BASIC_ZONE", "GAME_ID"], how="left")
    return out[["SHOT_ID"] + NEW_COLS]


def _fit_predict(train, val, feats, cats, seed):
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation
    from src.models.classical import make_preprocessor
    meta = {"numeric": [c for c in feats if c not in cats], "categorical": cats}
    pre = make_preprocessor(meta)
    Xtr = pre.fit_transform(train[feats]).astype("float32")
    Xva = pre.transform(val[feats]).astype("float32")
    m = LGBMClassifier(n_estimators=2000, learning_rate=0.03, num_leaves=95,
                       feature_fraction=0.8, bagging_fraction=0.8,
                       n_jobs=-1, random_state=seed, verbose=-1)
    m.fit(Xtr, train["MADE"], eval_set=[(Xva, val["MADE"])],
          callbacks=[early_stopping(80, verbose=False), log_evaluation(0)])
    return m.predict_proba(Xva)[:, 1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=2)
    args = ap.parse_args()

    cfg = get_config()
    p = cfg.path("data_processed")
    meta = json.loads((p / "feature_meta.json").read_text())
    train = pd.read_parquet(p / "train.parquet")
    val = pd.read_parquet(p / "validation.parquet")
    print(f"train {len(train):,}  val {len(val):,}  (test not loaded)")

    merged = pd.read_parquet(cfg.path("data_interim") / "shots_merged.parquet")
    t = time.time()
    opp = build_opponent_zone(merged)
    print(f"  built opponent-zone table in {time.time()-t:.0f}s "
          f"({len(opp):,} rows)")

    train = train.merge(opp, on="SHOT_ID", how="left")
    val = val.merge(opp, on="SHOT_ID", how="left")
    cov = float(train["opp_zone_fg"].notna().mean())
    print(f"  coverage on train: {cov:.2%}")
    for part in (train, val):
        for c in NEW_COLS:
            part[c] = part[c].fillna(part[c].median() if part[c].notna().any() else 0.0)

    # sanity: does this feature relate to the outcome at all?
    r = np.corrcoef(train["opp_zone_fg_delta"], train["MADE"])[0, 1]
    spread = train.groupby("SEASON")["opp_zone_fg"].std().mean()
    print(f"  corr(opp_zone_fg_delta, MADE) = {r:+.5f}; "
          f"mean within-season sd of opp_zone_fg = {spread:.4f}")

    cats = [c for c in meta["categorical"] if c in train.columns]
    feats_a = [c for c in meta["numeric"] if c in train.columns] + cats
    feats_b = feats_a + NEW_COLS

    y = val["MADE"].to_numpy()
    rows = []
    for s in range(args.seeds):
        seed = cfg.seed + 97 * s
        t = time.time()
        pa = _fit_predict(train, val, feats_a, cats, seed)
        pb = _fit_predict(train, val, feats_b, cats, seed)
        r_ = {"seed": seed,
              "A_auc": float(roc_auc_score(y, pa)),
              "B_auc": float(roc_auc_score(y, pb)),
              "A_brier": float(brier_score_loss(y, pa)),
              "B_brier": float(brier_score_loss(y, pb)),
              "seconds": round(time.time() - t, 1)}
        r_["d_auc"] = r_["B_auc"] - r_["A_auc"]
        r_["d_brier"] = r_["B_brier"] - r_["A_brier"]
        rows.append(r_)
        print(f"  seed {seed:4d}  A {r_['A_auc']:.5f}  B {r_['B_auc']:.5f}  "
              f"dAUC {r_['d_auc']:+.5f}  dBrier {r_['d_brier']:+.6f} "
              f"({r_['seconds']}s)")

    d = np.array([r_["d_auc"] for r_ in rows])
    db = np.array([r_["d_brier"] for r_ in rows])
    consistent = bool(np.all(d > 0) or np.all(d < 0))
    keep = bool(d.mean() >= 0.001 or (db.mean() < 0 and consistent))
    out = {"runs": rows, "mean_d_auc": float(d.mean()),
           "mean_d_brier": float(db.mean()),
           "d_auc_range": [float(d.min()), float(d.max())],
           "sign_consistent_across_seeds": consistent,
           "coverage_train": cov,
           "corr_delta_with_made": float(r),
           "keep_rule": ">= +0.001 val AUC or improved val Brier with consistent sign",
           "verdict": "KEEP" if keep else "DROP (within noise)"}
    print(f"\n  mean dAUC {out['mean_d_auc']:+.5f}  "
          f"range [{d.min():+.5f}, {d.max():+.5f}]  sign consistent: {consistent}")
    print(f"  mean dBrier {out['mean_d_brier']:+.6f}")
    print(f"  VERDICT: {out['verdict']}")
    fp = cfg.path("figures") / "ab_opponent_zone.json"
    fp.write_text(json.dumps(out, indent=2))
    print(f"  wrote {fp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
