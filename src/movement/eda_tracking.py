"""Production-level EDA for the 2015-16 full-tracking shot-quality model (Model 2).

Characterises the extracted per-shot tracking table BEFORE any modelling: how many
shots align, what each pre-release tracking feature looks like (including the
physically-impossible speed outliers the boosting study tolerated but a neural
set-model must not), which features actually separate makes from misses, and the
strict pre-/post-release split that keeps the outcome out of the feature set.

This is the honest groundwork for a model that sees REAL defender geometry — the
signal the 2021-26 core model can only impute. The headline, confirmed here:
the defender's ANGLE to the shot line separates outcomes; raw distance barely does.

CLI:  python -m src.movement.eda_tracking
Outputs: reports/TRACKING_EDA.md + reports/figures/tracking_eda_*.png
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import get_config

PRE = ["pre_def_dist", "pre_def_dist_2", "pre_def_angle", "pre_help_defenders",
       "pre_shooter_speed", "pre_closing_speed", "pre_shot_clock",
       "pre_time_with_ball", "pre_release_height"]
POST = ["post_apex_height", "post_entry_angle", "post_min_rim_dist",
        "post_through_hoop", "post_flight_time"]
# physical plausibility caps (ft, ft/s) — beyond these the value is a frame-dt
# division artefact, not a real measurement. Used for reporting here; the model
# prep applies the same caps.
SPEED_CAP = 40.0        # a sprinting NBA player tops out ~30 ft/s
CLOSE_CAP = 40.0


def _load(cfg) -> pd.DataFrame:
    fp = cfg.path("data_movement") / "shots_tracking.parquet"
    d = pd.read_parquet(fp)
    d["is_3"] = (d["SHOT_TYPE"].astype("string") == "3PT Field Goal").astype(int)
    for c in PRE + POST:
        if c in d.columns:
            d[c] = pd.to_numeric(d[c], errors="coerce")
    return d


def _outlier_report(d: pd.DataFrame) -> list[str]:
    """The speed features carry frame-dt division blow-ups. Quantify them."""
    lines = ["## Data-quality issue: kinematic outliers (must clip before modelling)",
             "",
             "`pre_shooter_speed` / `pre_closing_speed` are computed as distance /",
             "frame-dt; when two frames share a near-identical game clock the dt",
             "collapses and the value explodes far past anything physical. Gradient",
             "boosting is scale-invariant so the tracking *study* tolerated this, but",
             "a neural set-model standardises its inputs and these outliers would",
             "dominate the mean/variance. They are clipped in the model prep.",
             "",
             "| feature | median | p99 | max | % beyond cap |",
             "|---|---|---|---|---|"]
    for c, cap in (("pre_shooter_speed", SPEED_CAP), ("pre_closing_speed", CLOSE_CAP)):
        v = d[c].abs()
        lines.append(f"| {c} | {d[c].median():.2f} | {v.quantile(0.99):.1f} | "
                     f"{v.max():.0f} | {(v > cap).mean()*100:.2f}% (cap {cap}) |")
    lines.append("")
    return lines


def _make_rate_table(d: pd.DataFrame, col: str, bins, labels) -> pd.DataFrame:
    b = pd.cut(d[col], bins, labels=labels)
    return d.groupby(b, observed=True)["MADE"].agg(n="size", make_rate="mean")


def _corr_table(d: pd.DataFrame) -> pd.DataFrame:
    """Univariate |corr| with the target for pre vs post features — the leakage
    separation. Post-release ball flight correlates strongly (it IS the outcome);
    pre-release features are weak, as an honest shot-quality signal should be."""
    rows = []
    for c in PRE + POST:
        if c not in d.columns:
            continue
        v = d[c].to_numpy(dtype="float64")
        ok = np.isfinite(v)
        if ok.sum() < 100 or np.nanstd(v[ok]) == 0:
            continue
        r = float(np.corrcoef(v[ok], d["MADE"].to_numpy()[ok])[0, 1])
        rows.append({"feature": c, "family": "pre" if c.startswith("pre_") else "post",
                     "abs_corr_with_MADE": round(abs(r), 4), "corr": round(r, 4)})
    return pd.DataFrame(rows).sort_values("abs_corr_with_MADE", ascending=False)


def _figures(d: pd.DataFrame, fig_dir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig_dir.mkdir(parents=True, exist_ok=True)

    # (1) make rate vs defender angle & distance, by shot type — the headline
    fig, ax = plt.subplots(1, 2, figsize=(10, 4))
    ang_bins = [-1, 30, 60, 90, 181]; ang_lab = ["0-30", "30-60", "60-90", "90+"]
    dd_bins = [-1, 2, 4, 6, 9, 100]; dd_lab = ["0-2", "2-4", "4-6", "6-9", "9+"]
    for is3, name, col in [(0, "2PT", "#3b82f6"), (1, "3PT", "#ef4444")]:
        sub = d[d["is_3"] == is3]
        a = _make_rate_table(sub, "pre_def_angle", ang_bins, ang_lab)
        ax[0].plot(range(len(a)), a["make_rate"].values, marker="o", label=name, color=col)
        r = _make_rate_table(sub, "pre_def_dist", dd_bins, dd_lab)
        ax[1].plot(range(len(r)), r["make_rate"].values, marker="o", label=name, color=col)
    ax[0].set_xticks(range(len(ang_lab))); ax[0].set_xticklabels(ang_lab)
    ax[0].set_title("Make rate vs defender ANGLE to shot line")
    ax[0].set_xlabel("angle (deg): 0 = defender in the shot line"); ax[0].set_ylabel("make rate")
    ax[0].legend(); ax[0].grid(alpha=0.3)
    ax[1].set_xticks(range(len(dd_lab))); ax[1].set_xticklabels(dd_lab)
    ax[1].set_title("Make rate vs defender DISTANCE")
    ax[1].set_xlabel("closest defender (ft)"); ax[1].set_ylabel("make rate")
    ax[1].legend(); ax[1].grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(fig_dir / "tracking_eda_angle_vs_distance.png", dpi=130)
    plt.close(fig)

    # (2) make rate vs real shot clock
    fig, ax = plt.subplots(figsize=(6, 4))
    sc = _make_rate_table(d, "pre_shot_clock", [-1, 4, 8, 14, 19, 25],
                          ["0-4", "4-8", "8-14", "14-19", "19-24"])
    ax.plot(range(len(sc)), sc["make_rate"].values, marker="o", color="#8b5cf6")
    ax.set_xticks(range(len(sc))); ax.set_xticklabels(sc.index.astype(str))
    ax.set_title("Make rate vs REAL shot clock (2015-16 tracking)")
    ax.set_xlabel("shot clock (s remaining)"); ax.set_ylabel("make rate"); ax.grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(fig_dir / "tracking_eda_shot_clock.png", dpi=130)
    plt.close(fig)


def main() -> int:
    cfg = get_config()
    d = _load(cfg)
    n, ng, npl = len(d), d["GAME_ID"].nunique(), d["PLAYER_ID"].nunique()
    corr = _corr_table(d)
    _figures(d, cfg.path("figures"))

    ang = _make_rate_table(d, "pre_def_angle", [-1, 30, 60, 90, 181],
                           ["0-30", "30-60", "60-90", "90+"])
    dd = _make_rate_table(d, "pre_def_dist", [-1, 2, 4, 6, 9, 100],
                          ["0-2", "2-4", "4-6", "6-9", "9+"])

    def _tbl(df, idx_name):
        out = [f"| {idx_name} | n | make rate |", "|---|---|---|"]
        for k, r in df.iterrows():
            out.append(f"| {k} | {int(r['n']):,} | {r['make_rate']:.3f} |")
        return out

    lines = [
        "# TRACKING_EDA.md — 2015-16 full-tracking shot data (Model 2)",
        "",
        "Generated by `python -m src.movement.eda_tracking`. Characterises the",
        "per-shot SportVU tracking table before any modelling.",
        "",
        "## Dataset",
        "",
        f"- **{n:,} aligned shots** across **{ng} games** and **{npl} shooters** "
        f"(2015-16, the only season with public raw tracking).",
        f"- Overall make rate **{d['MADE'].mean():.3f}**; "
        f"2PT {d.loc[d['is_3']==0,'MADE'].mean():.3f} vs 3PT {d.loc[d['is_3']==1,'MADE'].mean():.3f}.",
        f"- Real shot clock present for {100*(1-d['pre_shot_clock'].isna().mean()):.1f}% of shots "
        "(imputed + flagged otherwise).",
        "",
        "Every feature is measured at the **physically-detected release frame** (the",
        "last frame the ball is in the shooter's hands), not the logged event time.",
        "",
    ]
    lines += _outlier_report(d)
    lines += [
        "## What actually separates makes from misses",
        "",
        "### Defender ANGLE to the shot line (0 deg = defender between shooter and rim)",
        "",
    ] + _tbl(ang, "angle (deg)") + [
        "",
        "### Defender DISTANCE (closest defender, ft)",
        "",
    ] + _tbl(dd, "distance (ft)") + [
        "",
        "**Finding:** the angle separates outcomes strongly (a defender *in the shot",
        "line* is what hurts); raw distance is nearly flat. This is the central",
        "result the core model cannot see, and it motivates a model over the defender",
        "*geometry*, not just a distance scalar.",
        "",
        "![angle vs distance](figures/tracking_eda_angle_vs_distance.png)",
        "![shot clock](figures/tracking_eda_shot_clock.png)",
        "",
        "## Leakage separation (pre- vs post-release), univariate |corr| with MADE",
        "",
        "| feature | family | corr | |corr| |",
        "|---|---|---|---|",
    ]
    for _, r in corr.iterrows():
        lines.append(f"| {r['feature']} | {r['family']} | {r['corr']:+.3f} | {r['abs_corr_with_MADE']:.3f} |")
    lines += [
        "",
        "Post-release ball-flight features correlate strongly with the outcome —",
        "because they *are* the outcome. They are quarantined (`post_*`) and never",
        "enter the model (`tests/test_no_leakage.py`). Every pre-release feature is",
        "weak alone, exactly as an honest shot-quality signal should be; the model's",
        "job is to combine them.",
        "",
        "## Split",
        "",
        "Modelling uses a **game-level chronological split** (70/15/15 by game order,",
        "monotonic with date within the season) — no game spans two splits, matching",
        "the core model's discipline. Train-fit shooter skill is fit on train only.",
    ]
    out = cfg.path("reports") / "TRACKING_EDA.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"  {n:,} shots | {ng} games | make rate {d['MADE'].mean():.3f}")
    print(f"  top pre-release signal: {corr[corr.family=='pre'].iloc[0]['feature']} "
          f"(|corr| {corr[corr.family=='pre'].iloc[0]['abs_corr_with_MADE']:.3f})")
    print(f"  wrote {out} + 2 figures")
    assert (d["pre_shooter_speed"].abs() > SPEED_CAP).mean() < 0.05, \
        "unexpectedly many speed outliers — check extraction"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
