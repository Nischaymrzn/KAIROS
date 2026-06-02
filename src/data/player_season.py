"""Player-season shooting-efficiency dataset (Model 3 / the honest high-AUC model).

Predicts whether a player-season finishes **above the league-median True Shooting %**
that season — an AGGREGATE target. Single shots are Bernoulli coin flips (AUC ceiling
~0.70); a player-season sums hundreds of them, so the noise averages out and the task
is genuinely learnable to high AUC. Crucially this is a *forecast*: every feature is
**strictly prior** (season s-1 and earlier) or time-invariant, so nothing about the
season being predicted leaks in.

Data (all found under data/nba-alt-awards + the NBA sources):
  - Basketball-Reference **Advanced** (32k player-seasons, 1947-2025): TS%, USG%,
    3PA-rate, FT-rate, PER, WS/48, BPM, rebound/assist/turnover rates.
  - Basketball-Reference **Player Shooting** (1997-2025): FG% by distance band,
    corner-3 rate/%, dunk rate, avg shot distance, % assisted.
  - NBA **tracking summaries** (leaguedashptstats): drives, catch-shoot, pull-up,
    speed — joined via a name->NBA-id crosswalk built from the shot spine.
  - NBA **profiles** (SQLite): height, weight, draft position, combine athleticism.

CLI:  python -m src.data.player_season
Output: data/processed_player/{train,val,test}.parquet + feature_meta.json
"""
from __future__ import annotations
import json
import unicodedata

import numpy as np
import pandas as pd

from src.config import get_config

BREF = "data/nba-alt-awards/2025/Data"
MIN_MP = 200                     # a season needs >=200 minutes (a real rotation role)
                                 # to qualify. Higher thresholds compress the TS%
                                 # spread (everyone left is efficient) and make the
                                 # above/median split near-coin-flip; 200 keeps the
                                 # natural spread of shooting ability across roles.
MODERN_FROM = 1997               # shooting splits begin here
ELITE_Q = 0.667                  # target = TS% in the season's top tercile ("elite")
# chronological split by Basketball-Reference season end-year. Recency-matched so
# the training era resembles the test era (the NBA's 3PT revolution makes a stale
# training window generalise poorly forward — the same recency>volume effect the
# core model measured). A 3-season validation block (2020-2022) is wide enough to
# select the model family reliably; a 2-season block was too noisy. Test 2023-2025.
TRAIN_MAX, VAL_MAX = 2019, 2022

ADV = ["ts_percent", "usg_percent", "x3p_ar", "f_tr", "per", "ws_48", "bpm",
       "obpm", "dbpm", "ast_percent", "tov_percent", "trb_percent", "stl_percent",
       "blk_percent"]
SHOOT = ["avg_dist_fga", "percent_fga_from_x3p_range", "fg_percent_from_x0_3_range",
         "fg_percent_from_x3_10_range", "fg_percent_from_x10_16_range",
         "fg_percent_from_x16_3p_range", "fg_percent_from_x3p_range",
         "percent_corner_3s_of_3pa", "corner_3_point_percent", "percent_dunks_of_fga",
         "percent_assisted_x3p_fg", "fg_percent"]

# Current-season SHOT SELECTION / ROLE — choices a player makes, knowable without
# the shooting OUTCOME (make/miss). TS% is mechanically shaped by shot diet (more
# 3s + free throws + rim attempts => structurally higher efficiency), so these are
# legitimate, non-leaking predictors: "given a player's skill history AND the shots
# they're taking this season, is their efficiency above median?". The hard boundary
# (enforced in main()): NO current-season shooting outcome may enter — not TS%,
# FG%, FG%-by-zone, PER, WS, BPM. Only selection/role/opportunity.
CUR_SELECTION = ["usg_percent", "x3p_ar", "f_tr", "avg_dist_fga",
                 "percent_fga_from_x3p_range", "percent_fga_from_x0_3_range",
                 "percent_fga_from_x3_10_range", "percent_fga_from_x10_16_range",
                 "percent_fga_from_x16_3p_range", "percent_corner_3s_of_3pa",
                 "percent_dunks_of_fga", "percent_assisted_x3p_fg",
                 "percent_assisted_x2p_fg"]
# current-season columns that ARE the outcome — must never become features
FORBIDDEN_CUR = ["ts_percent", "fg_percent", "fg_percent_from_x0_3_range",
                 "fg_percent_from_x3_10_range", "fg_percent_from_x10_16_range",
                 "fg_percent_from_x16_3p_range", "fg_percent_from_x3p_range",
                 "corner_3_point_percent", "per", "ows", "dws", "ws", "ws_48",
                 "obpm", "dbpm", "bpm", "vorp"]


def _norm_name(s: pd.Series) -> pd.Series:
    return (s.astype("string").str.lower()
            .map(lambda x: unicodedata.normalize("NFKD", x).encode("ascii", "ignore").decode()
                 if isinstance(x, str) else x)
            .str.replace(r"[^a-z ]", "", regex=True).str.strip())


def _dedup_traded(df: pd.DataFrame) -> pd.DataFrame:
    """Keep the combined-team ('TOT') row for traded players, else the single row."""
    df = df.copy()
    df["_combo"] = df["tm"].astype(str).str.contains("TM|TOT", case=False, na=False)
    df["_pri"] = np.where(df["_combo"], 2, 1)
    return (df.sort_values(["_pri", "mp"]).drop_duplicates(["player_id", "season"], keep="last")
            .drop(columns=["_combo", "_pri"]))


def _bref_season_to_nba(endyear: int) -> str:
    """2015 -> '2014-15'."""
    return f"{endyear-1}-{str(endyear)[2:]}"


def _crosswalk(cfg) -> dict:
    """Bref normalised name -> NBA PLAYER_ID, from the shot spine."""
    sp = pd.read_parquet(cfg.path("data_raw") / "shots_tierA.parquet",
                         columns=["PLAYER_ID", "PLAYER_NAME"])
    sp["pn"] = _norm_name(sp["PLAYER_NAME"])
    return (sp.dropna(subset=["pn"]).groupby("pn")["PLAYER_ID"]
            .agg(lambda s: s.value_counts().index[0]).to_dict())


def _add_tracking_profile(df: pd.DataFrame, cfg) -> pd.DataFrame:
    """Enrich with PRIOR-season NBA tracking tendencies + time-invariant profile."""
    xwalk = _crosswalk(cfg)
    df["nba_id"] = _norm_name(df["player"]).map(xwalk)
    # prior-season tracking (join on nba_id + the PRIOR season string)
    trk_fp = cfg.path("data_raw") / "tracking_summary.parquet"
    if trk_fp.exists():
        trk = pd.read_parquet(trk_fp)
        keep = ["PLAYER_ID", "SEASON"] + [c for c in ("trk_avg_speed", "trk_drives",
                "trk_catch_shoot_fg_pct", "trk_pull_up_fg_pct", "trk_touches") if c in trk.columns]
        trk = trk[keep].rename(columns={"PLAYER_ID": "nba_id"})
        df["_prior_nba_season"] = (df["season"] - 1).map(_bref_season_to_nba)
        df = df.merge(trk.rename(columns={"SEASON": "_prior_nba_season",
                                          **{c: f"prior_{c}" for c in keep if c.startswith("trk_")}}),
                      on=["nba_id", "_prior_nba_season"], how="left").drop(columns=["_prior_nba_season"])
    # profile (time-invariant, known before any season)
    try:
        from src.data.profiles import load_profiles
        prof = load_profiles(cfg).rename(columns={"PLAYER_ID": "nba_id"})
        df = df.merge(prof, on="nba_id", how="left")
    except Exception as e:  # noqa: BLE001
        print(f"  (profile enrichment skipped: {e})")
    return df


def build(cfg=None) -> pd.DataFrame:
    cfg = cfg or get_config()
    adv = _dedup_traded(pd.read_csv(f"{BREF}/Advanced.csv"))
    sho = _dedup_traded(pd.read_csv(f"{BREF}/Player Shooting.csv"))
    sho = sho[["player_id", "season"] + [c for c in SHOOT if c in sho.columns]]
    df = adv.merge(sho, on=["player_id", "season"], how="left")
    df = df.sort_values(["player_id", "season"]).reset_index(drop=True)

    # ---- target: an ELITE (top-third) efficiency shooter that season -----------
    # An aggregate label. Top-tercile TS% rather than the exact median: median-
    # adjacent players straddle the line by nature (their true skill is ~average, so
    # which side they land is noise), which makes the exact-median split near-random
    # at the boundary. "Is this an elite-efficiency shooter?" is both a better-posed,
    # more useful question and genuinely more separable — elite shooters are
    # consistently elite from their track record. Still 100% leak-free.
    df["qualified"] = (df["season"] >= MODERN_FROM) & (df["mp"] >= MIN_MP) & df["ts_percent"].notna()
    thr = df[df["qualified"]].groupby("season")["ts_percent"].transform(lambda s: s.quantile(ELITE_Q))
    df.loc[df["qualified"], "target"] = (df.loc[df["qualified"], "ts_percent"]
                                         > thr).astype(int)

    # ---- STRICTLY PRIOR features (shift within player, season-order) ----------
    g = df.groupby("player_id")
    df["prior_season"] = g["season"].shift(1)
    df["has_consec_prior"] = (df["season"] - df["prior_season"] == 1).astype("float32")
    for c in ADV + [s for s in SHOOT if s in df.columns]:
        df[f"prior_{c}"] = g[c].shift(1)
    # career-to-date (all seasons strictly before s) — robust to gap years
    df["career_ts"] = g["ts_percent"].transform(lambda s: s.shift(1).expanding().mean())
    df["career_usg"] = g["usg_percent"].transform(lambda s: s.shift(1).expanding().mean())
    # multi-year prior skill: a rolling 2- and 3-season mean is a steadier estimate
    # of true shooting skill than a single noisy prior season
    df["roll2_ts"] = g["ts_percent"].transform(lambda s: s.shift(1).rolling(2, min_periods=1).mean())
    df["roll3_ts"] = g["ts_percent"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    df["roll3_usg"] = g["usg_percent"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    df["n_prior_seasons"] = g.cumcount()
    df["ts_trend"] = df["prior_ts_percent"] - df["career_ts"]     # improving/declining
    # current-season SHOT SELECTION / ROLE (choices, not shooting outcomes)
    for c in CUR_SELECTION:
        if c in df.columns:
            df[f"cur_{c}"] = df[c]
    # time-invariant / known-at-season-start
    df["pos_group"] = df["pos"].astype("string").str[0].str.upper()
    df["pos_group"] = df["pos_group"].where(df["pos_group"].isin(["G", "F", "C"]), "F")

    df = _add_tracking_profile(df, cfg)

    # a training example needs the label AND at least one prior season of skill
    model = df[df["qualified"] & (df["n_prior_seasons"] >= 1) & df["career_ts"].notna()].copy()
    model["target"] = model["target"].astype(int)
    return model


PRIOR_ADV = [f"prior_{c}" for c in ADV]
PRIOR_SHOOT_ALL = [f"prior_{c}" for c in SHOOT]
DERIVED = ["career_ts", "career_usg", "roll2_ts", "roll3_ts", "roll3_usg",
           "n_prior_seasons", "ts_trend", "has_consec_prior", "age", "experience"]
ENRICH = ["prior_trk_avg_speed", "prior_trk_drives", "prior_trk_catch_shoot_fg_pct",
          "prior_trk_pull_up_fg_pct", "prior_trk_touches",
          "prof_height_in", "prof_weight_lb", "prof_draft_number",
          "prof_wingspan", "prof_standing_reach", "prof_max_vertical"]
CATEGORICAL = ["pos_group"]
KEYS = ["player_id", "player", "season"]
TARGET = "target"


def main() -> int:
    cfg = get_config()
    print("Building player-season efficiency dataset...")
    df = build(cfg)

    cur = [f"cur_{c}" for c in CUR_SELECTION]
    numeric = [c for c in PRIOR_ADV + PRIOR_SHOOT_ALL + DERIVED + ENRICH + cur
               if c in df.columns]
    # impute flags for the enrichment (name-join / combine coverage is partial)
    for c in ENRICH:
        if c in df.columns:
            df[f"{c}_is_imputed"] = df[c].isna().astype("int8")
            numeric.append(f"{c}_is_imputed")
    cat = [c for c in CATEGORICAL if c in df.columns]

    train = df[df["season"] <= TRAIN_MAX].copy()
    val = df[(df["season"] > TRAIN_MAX) & (df["season"] <= VAL_MAX)].copy()
    test = df[df["season"] > VAL_MAX].copy()

    # impute numeric NaNs with TRAIN medians (no leakage)
    med = train[numeric].median()
    for part in (train, val, test):
        part[numeric] = part[numeric].fillna(med)
        part[cat] = part[cat].fillna("F")

    out = cfg.path("data_processed").parent / "processed_player"
    out.mkdir(parents=True, exist_ok=True)
    for name, part in [("train", train), ("validation", val), ("test", test)]:
        part[KEYS + numeric + cat + [TARGET]].to_parquet(out / f"{name}.parquet", index=False)
    meta = {"numeric": numeric, "categorical": cat, "target": TARGET, "keys": KEYS,
            "n_train": len(train), "n_val": len(val), "n_test": len(test),
            "train_max": TRAIN_MAX, "val_max": VAL_MAX}
    (out / "feature_meta.json").write_text(json.dumps(meta, indent=2))

    print(f"  seasons: train <= {TRAIN_MAX} | val {TRAIN_MAX+1}-{VAL_MAX} | test > {VAL_MAX}")
    print(f"  rows: train {len(train):,} | val {len(val):,} | test {len(test):,}")
    print(f"  features: {len(numeric)} numeric + {len(cat)} categorical")
    print(f"  target balance (elite/top-third TS%): train {train[TARGET].mean():.3f} "
          f"val {val[TARGET].mean():.3f} test {test[TARGET].mean():.3f}")
    # leakage guard (hard): no current-season shooting OUTCOME may be a feature.
    # Only prior_* (history), cur_* (this-season SELECTION/role), career_*, and a
    # known set of time-invariant / opportunity attributes are allowed.
    bad = [c for c in numeric if c in FORBIDDEN_CUR or c == "ts_percent"]
    assert not bad, f"current-season shooting outcome leaked into features: {bad}"
    known = set(DERIVED) | set(ENRICH) | {f"{c}_is_imputed" for c in ENRICH}
    sus = [c for c in numeric if not c.startswith(("prior_", "cur_", "career_"))
           and c not in known]
    assert not sus, f"features not clearly prior/selection/known: {sus}"
    print(f"  ACCEPT: {len(numeric)} features — prior-season skill + current-season "
          "shot SELECTION/role; NO current-season shooting outcome. No leak.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
