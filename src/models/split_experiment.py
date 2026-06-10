"""Split-methodology experiment — does mixing the seasons inflate the score?

The user's question: instead of training on the past and testing on the future,
mix all seasons and split randomly. This module measures exactly what that does,
on identical data and an identical model, under three validation schemes:

  A. chronological  — train on earlier seasons, test on the most recent (2025-26).
                      This is deployment-realistic: you always predict the future.
  B. random shuffle — the whole pool shuffled and split 85/15 (seeded, stratified).
                      Shots from the SAME GAME land in both train and test.
  C. group-by-game  — random 85/15 but no game appears in both (GroupShuffleSplit).
                      Removes the same-game leak; the honest "random-ish" option.

Train-only statistics (zone FG%, player skill) are re-fit *within each split's
training set*, so no scheme is handed leakage for free. The gap between A and B is
the **optimism bias** of a random split — a number that cannot be achieved in
production because it depends on seeing the test games during training.

CLI:  python -m src.models.split_experiment
Outputs: reports/figures/split_experiment.json
"""
from __future__ import annotations
import json

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, GroupShuffleSplit
from sklearn.metrics import roc_auc_score, brier_score_loss, accuracy_score

from src.config import get_config
from src.features.build import engineer, CATEGORICAL, TARGET
from src.features.groups import dropped_columns
from src.models.classical import make_preprocessor

TEST_SEASON = "2025-26"


def _add_trainfit(train: pd.DataFrame, parts: list[pd.DataFrame]) -> None:
    """Fit zone FG%, player frequency and player skill on `train`; map onto every
    frame in `parts` (which includes train). Mirrors src/features/build.py."""
    rate = train.groupby(["basic_zone", "zone_range"], observed=True)[TARGET].mean()
    glob = float(train[TARGET].mean())
    freq = train["player_id"].value_counts()
    p_fg = train.groupby("player_id")[TARGET].mean()
    tr3 = train[train["is_3pt"] == 1]
    p_3p = tr3.groupby("player_id")[TARGET].mean()
    glob_fg, glob_3p = glob, (float(tr3[TARGET].mean()) if len(tr3) else glob)
    for df in parts:
        idx = pd.MultiIndex.from_arrays([df["basic_zone"], df["zone_range"]])
        df["zone_fg_pct"] = rate.reindex(idx).fillna(glob).to_numpy().astype("float32")
        df["xp"] = (df["zone_fg_pct"] * np.where(df["is_3pt"] == 1, 3.0, 2.0)).astype("float32")
        df["player_freq"] = df["player_id"].map(freq).fillna(0).astype("float32")
        df["player_fg_pct"] = df["player_id"].map(p_fg).fillna(glob_fg).astype("float32")
        df["player_3p_pct"] = df["player_id"].map(p_3p).fillna(glob_3p).astype("float32")


def _feature_cols(frame: pd.DataFrame, cfg):
    drop = dropped_columns(getattr(getattr(cfg, "features", None), "drop_groups", []))
    cat = [c for c in CATEGORICAL if c not in drop and c in frame.columns]
    non_feature = set(CATEGORICAL) | {"SHOT_ID", "SEASON", "GAME_ID", "SHOT_TYPE",
                                      TARGET, "player_id"}
    num = [c for c in frame.columns
           if c not in non_feature and c not in drop and frame[c].dtype.kind in "if"]
    return num, cat


def _fit_eval(train, test, cfg) -> dict:
    from lightgbm import LGBMClassifier
    num, cat = _feature_cols(train, cfg)
    pre = make_preprocessor({"numeric": num, "categorical": cat})
    Xtr = pre.fit_transform(train[num + cat]).astype("float32")
    Xte = pre.transform(test[num + cat]).astype("float32")
    m = LGBMClassifier(n_estimators=600, learning_rate=0.03, num_leaves=128,
                       feature_fraction=0.7, bagging_fraction=0.7, n_jobs=-1,
                       random_state=cfg.seed)
    m.fit(Xtr, train[TARGET])
    p = m.predict_proba(Xte)[:, 1]
    y = test[TARGET].to_numpy()
    return {"auc": float(roc_auc_score(y, p)),
            "brier": float(brier_score_loss(y, p)),
            "accuracy": float(accuracy_score(y, (p >= 0.5).astype(int))),
            "n_train": int(len(train)), "n_test": int(len(test))}


def main() -> int:
    cfg = get_config()
    merged = pd.read_parquet(cfg.path("data_interim") / "shots_merged.parquet")
    feats, _ = engineer(merged)
    feats["SEASON"] = merged["SEASON"].values
    feats["GAME_ID"] = merged["GAME_ID"].values
    feats["player_id"] = feats["player_id"].values
    print(f"full engineered frame: {len(feats):,} shots, "
          f"{feats['SEASON'].nunique()} seasons")

    rng = cfg.seed
    results = {}

    # A. chronological — test on the most recent season
    te_mask = feats["SEASON"] == TEST_SEASON
    tr = feats[~te_mask].copy()
    te = feats[te_mask].copy()
    _add_trainfit(tr, [tr, te])
    results["A_chronological"] = _fit_eval(tr, te, cfg)

    # B. random shuffle 85/15 (stratified) — same-game leakage present
    idx = np.arange(len(feats))
    tr_i, te_i = train_test_split(idx, test_size=0.15, random_state=rng,
                                  stratify=feats[TARGET].to_numpy())
    tr = feats.iloc[tr_i].copy()
    te = feats.iloc[te_i].copy()
    _add_trainfit(tr, [tr, te])
    results["B_random_shuffle"] = _fit_eval(tr, te, cfg)

    # C. group-by-game 85/15 — no game in both splits
    gss = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=rng)
    tr_i, te_i = next(gss.split(feats, groups=feats["GAME_ID"].to_numpy()))
    tr = feats.iloc[tr_i].copy()
    te = feats.iloc[te_i].copy()
    _add_trainfit(tr, [tr, te])
    results["C_group_by_game"] = _fit_eval(tr, te, cfg)

    print(f"\n{'scheme':<22} {'test AUC':>9} {'accuracy':>9} {'Brier':>8}  note")
    notes = {"A_chronological": "deployment-realistic (HONEST)",
             "B_random_shuffle": "same-game leakage -> OPTIMISTIC",
             "C_group_by_game": "no same-game leak"}
    for k, r in results.items():
        print(f"{k:<22} {r['auc']:>9.4f} {r['accuracy']:>9.4f} {r['brier']:>8.4f}  {notes[k]}")

    a = results["A_chronological"]["auc"]
    b = results["B_random_shuffle"]["auc"]
    print(f"\n  optimism bias of a random split (B - A): {b - a:+.4f} AUC")
    print("  This gap is the score a random split BORROWS from the future and")
    print("  cannot deliver in production. The honest number is A (chronological).")

    (cfg.path("figures") / "split_experiment.json").write_text(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
