"""The 2014-15 defender study — a self-contained thesis chapter.

Per-shot closest-defender distance is public only for the 2014-15 season
(`shot_logs.csv`, ~128k shots). This study quantifies **what that tracking-grade
defender signal is worth** by training the *same* model twice on the *same*
chronological split — once WITHOUT defender features, once WITH — and reporting
the AUC / Brier gap, overall and for 3-pointers.

This dataset is a SEPARATE study: it is never merged into the 2018-23 core
window (different season, incompatible features). The result is the honest answer
to "what would full tracking data add to the core model?".

CLI:  python -m src.studies.defender_2015
Outputs: reports/DEFENDER_STUDY.md + reports/figures/defender_*.png
"""
from __future__ import annotations
import json

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config
from src.seeds import set_global_seed

# contest tiers (closest-defender distance, feet) shared with the serving layer
CONTEST_TIERS = [("smother", 0.0, 1.5), ("heavy", 1.5, 3.0),
                 ("contested", 3.0, 4.5), ("light", 4.5, 6.0), ("open", 6.0, 99.0)]

# features shared by both models (available in ALL seasons)
COMMON = ["shot_dist", "is_3", "dribbles", "touch_time", "shot_clock",
          "shot_clock_imp", "period", "is_home", "game_clock_sec", "player_fg"]
# tracking-only features (the thing under study)
DEFENDER = ["close_def_dist", "def_x_3", "contest_heavy", "contest_open"]


def _load(cfg) -> pd.DataFrame:
    fp = cfg.raw_path("shot_logs_2014_15")
    df = pd.read_csv(fp)
    df.columns = [c.strip() for c in df.columns]
    df = df.rename(columns={
        "SHOT_DIST": "shot_dist", "DRIBBLES": "dribbles",
        "TOUCH_TIME": "touch_time", "SHOT_CLOCK": "shot_clock",
        "PERIOD": "period", "CLOSE_DEF_DIST": "close_def_dist",
        "PTS_TYPE": "pts_type", "FGM": "made", "GAME_ID": "game_id",
        "LOCATION": "location", "GAME_CLOCK": "game_clock", "player_id": "player_id",
    })
    df = df[df["shot_dist"].notna() & df["close_def_dist"].notna()].copy()
    df["made"] = df["made"].astype(int)
    df["is_3"] = (df["pts_type"] == 3).astype(int)
    df["is_home"] = (df["location"].astype("string").str.upper() == "H").astype(int)
    # touch time has sentinel negatives; clip to plausible range
    df["touch_time"] = df["touch_time"].clip(lower=0, upper=24)
    # game clock "MM:SS" -> seconds remaining in the period
    mm = df["game_clock"].astype("string").str.split(":", expand=True)
    df["game_clock_sec"] = (pd.to_numeric(mm[0], errors="coerce") * 60
                            + pd.to_numeric(mm[1], errors="coerce")).fillna(0)
    return df.reset_index(drop=True)


def _chrono_split(df: pd.DataFrame):
    """Split by GAME_ID order (monotonic with date within the season): first 70%
    of games -> train, next 15% -> val, last 15% -> test."""
    games = np.sort(df["game_id"].unique())
    n = len(games)
    tr = set(games[: int(0.70 * n)])
    va = set(games[int(0.70 * n): int(0.85 * n)])
    te = set(games[int(0.85 * n):])
    return (df[df["game_id"].isin(tr)].copy(),
            df[df["game_id"].isin(va)].copy(),
            df[df["game_id"].isin(te)].copy())


def _engineer(train, val, test):
    """Build model columns; train-fit player skill + shot-clock imputation."""
    # shot clock: NaN at end-of-period buzzer shots -> impute (train median) + flag
    sc_med = float(train["shot_clock"].median())
    for part in (train, val, test):
        part["shot_clock_imp"] = part["shot_clock"].isna().astype(int)
        part["shot_clock"] = part["shot_clock"].fillna(sc_med)
        # defender-derived
        part["def_x_3"] = part["close_def_dist"] * part["is_3"]
        part["contest_heavy"] = (part["close_def_dist"] < 2).astype(int)
        part["contest_open"] = (part["close_def_dist"] >= 6).astype(int)

    # player historical make rate (train only), mapped to val/test
    p_fg = train.groupby("player_id")["made"].mean()
    glob = float(train["made"].mean())
    for part in (train, val, test):
        part["player_fg"] = part["player_id"].map(p_fg).fillna(glob).astype("float32")
    return train, val, test


def _fit_eval(train, val, test, cols):
    """LightGBM + isotonic (fit on val). Returns calibrated test probabilities."""
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation
    m = LGBMClassifier(n_estimators=3000, learning_rate=0.02, num_leaves=63,
                       feature_fraction=0.8, bagging_fraction=0.8, n_jobs=-1,
                       random_state=42)
    m.fit(train[cols], train["made"],
          eval_set=[(val[cols], val["made"])],
          callbacks=[early_stopping(80), log_evaluation(0)])
    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(m.predict_proba(val[cols])[:, 1], val["made"])
    return iso.transform(m.predict_proba(test[cols])[:, 1])


def _metrics(y, p) -> dict:
    return {"auc": roc_auc_score(y, p), "brier": brier_score_loss(y, p), "n": int(len(y))}


def _figures(df: pd.DataFrame, cfg):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig_dir = cfg.path("figures")

    # make rate vs defender-distance bucket, split by shot type
    bins = [0, 2, 4, 6, 100]
    labels = ["0-2 (heavy)", "2-4 (tight)", "4-6 (open)", "6+ (wide)"]
    df = df.assign(bucket=pd.cut(df["close_def_dist"], bins=bins, labels=labels,
                                 right=False))
    fig, ax = plt.subplots(figsize=(6.5, 4))
    for is3, name in [(0, "2PT"), (1, "3PT")]:
        sub = df[df["is_3"] == is3].groupby("bucket", observed=True)["made"].mean()
        ax.plot(range(len(sub)), sub.values, marker="o", label=name)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=15)
    ax.set_ylabel("make rate")
    ax.set_xlabel("closest-defender distance (ft)")
    ax.set_title("2014-15: make rate vs defender distance, by shot type")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(fig_dir / "defender_makerate.png", dpi=130)
    plt.close(fig)
    return str((fig_dir / "defender_makerate.png"))


def _contest_curve(df: pd.DataFrame, cfg) -> dict:
    """Empirical make-rate multipliers per contest tier, by shot class, relative
    to that class's overall make rate. Serving applies these to the core model's
    (contest-blind) probability so the Defensive view reflects real tracking data.
    Saved to models/studies/contest_curve.json."""
    curve = {}
    for is3, name in [(0, "2PT"), (1, "3PT")]:
        sub = df[df["is_3"] == is3]
        overall = float(sub["made"].mean())
        tiers = {}
        for tier, lo, hi in CONTEST_TIERS:
            m = sub[(sub["close_def_dist"] >= lo) & (sub["close_def_dist"] < hi)]["made"].mean()
            tiers[tier] = round(float(m) / overall, 4) if overall > 0 and m == m else 1.0
        curve[name] = tiers
    out = cfg.path("models") / "studies"
    out.mkdir(parents=True, exist_ok=True)
    (out / "contest_curve.json").write_text(json.dumps(curve, indent=2))
    return curve


def _write_report(res: dict, fig_path: str, cfg) -> None:
    def row(tag, m):
        return (f"| {tag} | {m['auc']:.4f} | {m['brier']:.4f} | {m['n']:,} |")

    a, b = res["without"], res["with"]
    a3, b3 = res["without_3pt"], res["with_3pt"]
    md = f"""# DEFENDER_STUDY.md — the value of per-shot defender distance (2014-15)

Per-shot closest-defender distance is publicly available only for **2014-15**
(`shot_logs.csv`, {res['n_total']:,} shots). We train the **same LightGBM** on the
**same chronological split** (by game order: 70% train / 15% val / 15% test),
isotonic-calibrated on validation, **without** vs **with** the defender features.
The gap is the honest value of tracking-grade defender data. This dataset is
never merged into the 2018-23 core model.

## Results (held-out test)

| Model | AUC | Brier | n |
|---|---|---|---|
{row("Without defender", a)}
{row("With defender", b)}

**Overall delta: AUC {b['auc']-a['auc']:+.4f}, Brier {b['brier']-a['brier']:+.4f}.**

### 3-point shots only (where contest matters most)

| Model | AUC | Brier | n |
|---|---|---|---|
{row("Without defender (3PT)", a3)}
{row("With defender (3PT)", b3)}

**3PT delta: AUC {b3['auc']-a3['auc']:+.4f}, Brier {b3['brier']-a3['brier']:+.4f}.**

## Interpretation

Defender distance is a **real but bounded** signal for shot-make prediction: it
helps most on 3-pointers (an open catch-and-shoot three is far easier than a
contested one), and less overall because location and shot type already capture
much of the difficulty. This quantifies the ceiling the 2018-23 core model gives
up by lacking per-shot tracking — and shows the honest size of that gap rather
than assuming tracking is a silver bullet.

![make rate vs defender distance]({fig_path.split('reports/')[-1] if 'reports/' in fig_path else fig_path})

*Figure: 2014-15 make rate vs closest-defender distance, by shot type.*
"""
    (cfg.path("reports") / "DEFENDER_STUDY.md").write_text(md, encoding="utf-8")


def main() -> int:
    cfg = get_config()
    set_global_seed(cfg.seed)
    df = _load(cfg)
    print(f"2014-15 shot logs: {len(df):,} shots, make rate {df['made'].mean():.3f}")

    train, val, test = _chrono_split(df)
    train, val, test = _engineer(train, val, test)
    print(f"  split -> train {len(train):,} | val {len(val):,} | test {len(test):,}")

    p_without = _fit_eval(train, val, test, COMMON)
    p_with = _fit_eval(train, val, test, COMMON + DEFENDER)
    y = test["made"].to_numpy()
    m3 = test["is_3"].to_numpy() == 1

    res = {
        "n_total": len(df),
        "without": _metrics(y, p_without),
        "with": _metrics(y, p_with),
        "without_3pt": _metrics(y[m3], p_without[m3]),
        "with_3pt": _metrics(y[m3], p_with[m3]),
    }
    fig = _figures(df, cfg)
    curve = _contest_curve(df, cfg)
    _write_report(res, fig, cfg)
    print(f"  contest curve (3PT): {curve['3PT']}")

    a, b = res["without"], res["with"]
    a3, b3 = res["without_3pt"], res["with_3pt"]
    print("\n  Defender-distance value (test):")
    print(f"    overall  AUC {a['auc']:.4f} -> {b['auc']:.4f} "
          f"({b['auc']-a['auc']:+.4f}); Brier {a['brier']:.4f} -> {b['brier']:.4f}")
    print(f"    3PT only AUC {a3['auc']:.4f} -> {b3['auc']:.4f} "
          f"({b3['auc']-a3['auc']:+.4f})")
    print("  wrote reports/DEFENDER_STUDY.md + figure")
    assert b["auc"] >= a["auc"] - 1e-6, "defender features should not hurt AUC"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
