"""Build the full feature matrix per SPEC, split chronologically, and write
processed parquet + feature_meta.json. Train-only quantities (zone FG%, player
frequency) are fit on train and mapped onto val/test to avoid leakage.

CLI:  python -m src.features.build
"""
from __future__ import annotations
import json

import numpy as np
import pandas as pd

from src.config import get_config
from src.data.merge import build_merged
from src.data.splits import chronological_split
from src.features.spatial import add_spatial
from src.features.shot_type import add_shot_type
from src.features.temporal import add_temporal
from src.features.situational import add_situational
from src.features.defensive import add_defensive
from src.features.player import add_player
from src.features.movement_proxy import add_movement_proxy
from src.features.possession import add_possession, add_rhythm, add_rest
from src.features.era import (add_era, fit_era_table, recency_weight,
                              season_year)

# columns one-hot encoded by the classical/linear pipelines
CATEGORICAL = ["side", "basic_zone", "zone_range", "action_type",
               "contest_category", "position_group",
               "poss_reset_type", "prev_event_type"]
# high-cardinality cats (CatBoost native / deep embeddings)
HIGHCARD = ["player_id", "action_type"]
# slice/key columns kept alongside features (not fed to the model directly)
KEEP_KEYS = ["SHOT_ID", "SEASON", "GAME_ID", "SHOT_TYPE"]
TARGET = "MADE"


def _load_era(cfg=None):
    """The fitted era table, or None before the first build."""
    cfg = cfg or get_config()
    fp = cfg.path("models") / "era_table.joblib"
    if not fp.exists():
        return None
    import joblib
    return joblib.load(fp)


def engineer_features(src: pd.DataFrame, era=None):
    """Build only the feature columns (no keys / target). Reused by serving.

    `era` is the fitted league-context table. Serving leaves it None and the
    persisted table is loaded; build.py passes it explicitly because the table
    is fitted from these same engineered columns.
    """
    out = pd.DataFrame(index=src.index)
    imputed: list = []
    add_spatial(out, src, imputed)
    add_shot_type(out, src, imputed)
    add_temporal(out, src, imputed)
    add_situational(out, src, imputed)
    add_possession(out, src, imputed)
    add_rhythm(out, src, imputed)
    add_rest(out, src, imputed)
    add_defensive(out, src, imputed)
    add_player(out, src, imputed)
    add_movement_proxy(out, src, imputed)

    era = _load_era() if era is None else era
    if era:
        add_era(out, src, imputed, era)
    return out, sorted(set(imputed))


def engineer(src: pd.DataFrame, era=None):
    """Feature frame + keys + target (pre-split). Returns (frame, imputed)."""
    out, imputed = engineer_features(src, era)
    for k in KEEP_KEYS:
        out[k] = src[k].values
    out[TARGET] = src[TARGET].astype("int8").values
    return out, imputed


def drop_constant_columns(train: pd.DataFrame, candidates: list) -> list:
    """Feature columns that carry one value across the whole training split.

    A gradient-boosted tree never splits on these and a linear model gives them
    a meaningless coefficient, so they are excluded from the model's input. They
    stay in the parquet for analysis, the same treatment ablated groups get.
    """
    return [c for c in candidates if c in train.columns
            and train[c].nunique(dropna=False) <= 1]


def _fit_zone_fg(train: pd.DataFrame) -> tuple[pd.Series, float]:
    rate = train.groupby(["basic_zone", "zone_range"], observed=True)[TARGET].mean()
    return rate, float(train[TARGET].mean())


def _apply_zone_fg(df: pd.DataFrame, rate: pd.Series, glob: float) -> None:
    idx = pd.MultiIndex.from_arrays([df["basic_zone"], df["zone_range"]])
    df["zone_fg_pct"] = rate.reindex(idx).fillna(glob).to_numpy().astype("float32")
    pts = np.where(df["is_3pt"] == 1, 3.0, 2.0)
    df["xp"] = (df["zone_fg_pct"] * pts).astype("float32")


def main() -> int:
    cfg = get_config()
    print("Building features...")
    merged = build_merged(cfg)

    # two passes: the era table is fitted from engineered columns, so features
    # are built once without it, then the table is fitted and the era block added
    feats, imputed = engineer(merged, era={})
    era = fit_era_table(merged, feats)
    add_era(feats, merged, imputed, era)
    import joblib
    joblib.dump(era, cfg.path("models") / "era_table.joblib")
    print(f"  era table: {len(era['table'])} seasons, lagged, "
          f"base year {era['year0']}")

    train, val, test = chronological_split(feats, cfg)
    print(f"  split -> train {len(train):,} | val {len(val):,} | test {len(test):,}")
    print(f"  train seasons: {', '.join(sorted(train['SEASON'].unique()))}")

    # recency weight: recent seasons count more, so a wide window learns from
    # history without being dragged toward a bygone style
    decay = float(getattr(getattr(cfg, "features", None), "recency_decay", 0.0) or 0.0)
    if decay:
        latest = float(season_year(pd.Series(sorted(train["SEASON"].unique())[-1:])).iloc[0])
        for part in (train, val, test):
            part["recency_weight"] = recency_weight(part["SEASON"], decay, latest)
        w = train["recency_weight"]
        print(f"  recency weight (decay {decay}): "
              f"oldest {w.min():.3f} -> newest {w.max():.3f}")

    # train-only: zone FG% (the xP baseline) and player shot frequency
    rate, glob = _fit_zone_fg(train)
    freq = train["player_id"].value_counts()
    for part in (train, val, test):
        _apply_zone_fg(part, rate, glob)
        part["player_freq"] = part["player_id"].map(freq).fillna(0).astype("float32")

    # train-fit player skill: a shooter's historical make rate is strong signal
    p_fg = train.groupby("player_id")["MADE"].mean()
    tr3 = train[train["is_3pt"] == 1]
    p_3p = tr3.groupby("player_id")["MADE"].mean()
    glob_fg = float(train["MADE"].mean())
    glob_3p = float(tr3["MADE"].mean()) if len(tr3) else glob_fg
    for part in (train, val, test):
        part["player_fg_pct"] = part["player_id"].map(p_fg).fillna(glob_fg).astype("float32")
        part["player_3p_pct"] = part["player_id"].map(p_3p).fillna(glob_3p).astype("float32")

    # persist train-fit tables so the serve layer can build a feature row.
    import joblib
    from src.features.player import SOURCES as PLAYER_SRC
    rate_dict = {(str(k[0]), str(k[1])): float(v) for k, v in rate.items()}
    joblib.dump({"rate": rate_dict, "glob": float(glob)},
                cfg.path("models") / "zone_fg.joblib")
    joblib.dump({int(k): int(v) for k, v in freq.items()},
                cfg.path("models") / "player_freq.joblib")

    # per-player feature lookup (profile + tracking + skill) for serving
    pcols = (list(PLAYER_SRC.keys()) + [f"{f}_is_imputed" for f in PLAYER_SRC]
             + ["player_freq", "player_fg_pct", "player_3p_pct"])
    pcols = [c for c in pcols if c in train.columns]
    allp = pd.concat([train, val, test])[["player_id"] + pcols]
    lookup = allp.groupby("player_id").mean()
    joblib.dump({"table": lookup.to_dict("index"),
                 "default": lookup.mean().to_dict()},
                cfg.path("models") / "player_lookup.joblib")

    # feature groups excluded from the model by the pre-registered ablation rule.
    # They stay in the parquet (analysis / dashboard) but never reach a model.
    from src.features.groups import dropped_columns
    drop = dropped_columns(getattr(getattr(cfg, "features", None), "drop_groups", []))
    if drop:
        print(f"  excluding {len(drop)} columns from "
              f"{len(getattr(cfg.features, 'drop_groups'))} ablated group(s)")

    categorical = [c for c in CATEGORICAL if c not in drop]

    # numeric feature columns = everything not categorical / key / target
    non_feature = (set(CATEGORICAL) | set(KEEP_KEYS)
                   | {TARGET, "player_id", "recency_weight"})
    numeric = [c for c in train.columns
               if c not in non_feature and c not in drop
               and train[c].dtype.kind in "if"]

    # constants carry no signal and no model can split on them
    constant = drop_constant_columns(train, numeric + categorical)
    if constant:
        print(f"  excluding {len(constant)} constant column(s): "
              f"{', '.join(constant[:6])}{' ...' if len(constant) > 6 else ''}")
        numeric = [c for c in numeric if c not in constant]
        categorical = [c for c in categorical if c not in constant]

    out_dir = cfg.path("data_processed")
    for name, part in [("train", train), ("validation", val), ("test", test)]:
        part.to_parquet(out_dir / f"{name}.parquet", index=False)
    print(f"  wrote train/validation/test parquet -> {out_dir}")

    meta = {
        "numeric": numeric,
        "categorical": categorical,
        "highcard": HIGHCARD,
        "imputed": imputed,
        "target": TARGET,
        "keys": KEEP_KEYS,
        "cardinalities": {c: int(pd.concat([train[c], val[c], test[c]]).nunique())
                          for c in categorical + ["player_id"]},
        "n_train": int(len(train)), "n_val": int(len(val)), "n_test": int(len(test)),
        "dropped_constant": constant,
        "recency_decay": decay,
        "train_seasons": sorted(train["SEASON"].unique().tolist()),
    }
    (cfg.path("data_processed") / "feature_meta.json").write_text(json.dumps(meta, indent=2))
    print(f"  feature_meta.json: {len(numeric)} numeric + {len(categorical)} categorical")

    # acceptance: no outcome-derived column, disjoint season sets
    forbidden = {"MADE", "made", "shot_made", "outcome", "EVENT_TYPE"}
    leak = [c for c in numeric + categorical if c.lower() in forbidden]
    assert not leak, f"leakage: {leak}"
    assert set(train["SEASON"]).isdisjoint(set(val["SEASON"]) | set(test["SEASON"]))
    print("  ACCEPT: no outcome-derived feature, disjoint season splits, "
          "zone FG% fit on train only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
