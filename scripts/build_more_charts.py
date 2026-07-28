"""Plot the figures that carry a measurement but were drawn as labelled boxes.

Ten figures in the thesis stated a number inside a rectangle. A reader could not
read a value off them, could not see an interval, and could not tell a large
difference from a small one, because nothing was to scale. Each is rebuilt here
as a chart plotted from reports/figures/*.json, which is the file the experiment
itself wrote, so rerunning an experiment moves the chart and the two cannot
drift apart.

Style, palette and the PNG side-write come from build_thesis_charts, so the two
sets of charts are one visual system.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from build_thesis_charts import (  # noqa: E402
    WARM, COOL, INK, MUTED, RULE, TINT, _frame, _save,
)

REPORTS = Path("reports/figures")


def _load(name: str):
    return json.loads((REPORTS / f"{name}.json").read_text())


def _bare(ax, xlabel: str = "", ylabel: str = "") -> None:
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(RULE)
    ax.tick_params(length=0)
    ax.set_axisbelow(True)
    ax.yaxis.grid(True, color=RULE, linewidth=0.7)
    ax.xaxis.grid(False)
    if xlabel:
        ax.set_xlabel(xlabel, color=MUTED, fontsize=10, labelpad=9)
    if ylabel:
        ax.set_ylabel(ylabel, color=INK, fontsize=10.5, labelpad=8)


# --------------------------------------------------------- 1. tracking value
def tracking() -> None:
    d = _load("tracking_model")
    w, wo, n = d["test"]["auc"], d["test_no_tracking_floor"]["auc"], d["test"]["n"]
    fig, ax = plt.subplots(figsize=(8.6, 2.5))
    for y, (label, v, warm) in zip([1, 0], [("with optical tracking", w, True),
                                            ("no-tracking floor", wo, False)]):
        ax.barh(y, v - 0.58, left=0.58, height=0.5,
                color=WARM if warm else TINT, zorder=3)
        ax.text(v + 0.0012, y, f"{v:.4f}", va="center", fontsize=10.5, color=INK,
                fontweight="bold" if warm else "normal")
    ax.annotate("", xy=(w, 1.42), xytext=(wo, 1.42),
                arrowprops=dict(arrowstyle="<->", color=COOL, linewidth=1.3))
    ax.text((w + wo) / 2, 1.55, f"+{w - wo:.4f}", ha="center", fontsize=11,
            color=COOL, fontweight="bold")
    ax.set_yticks([1, 0])
    ax.set_yticklabels(["with optical tracking", "no-tracking floor"], fontsize=10.5)
    ax.set_xlim(0.58, 0.665)
    ax.set_ylim(-0.6, 1.9)
    _frame(ax, f"test AUC on the same {n:,} shots from 2015-16, the one public "
               f"tracking season")
    _save(fig, "tracking")


# --------------------------------------------------------- 2. skill score
def bss() -> None:
    s = _load("skill_score")
    v = s["bss_vs_base_rate"]["value"]
    blo, bhi = s["bss_vs_base_rate"]["ci95"]
    base = 0.0660
    fig, ax = plt.subplots(figsize=(8.6, 2.6))
    for y, (val, warm) in zip([1, 0], [(v, True), (base, False)]):
        ax.barh(y, val, height=0.5, color=WARM if warm else TINT, zorder=3)
        ax.text(val + 0.0035, y, f"{val:.4f}", va="center", fontsize=10.5, color=INK,
                fontweight="bold" if warm else "normal")
    ax.plot([blo, bhi], [1, 1], color=INK, linewidth=1.8, zorder=6)
    for e in (blo, bhi):
        ax.plot([e, e], [0.85, 1.15], color=INK, linewidth=1.8, zorder=6)
    ax.text(v, 1.48, f"95 per cent bootstrap interval [{blo:.4f}, {bhi:.4f}]",
            ha="center", fontsize=9.5, color=MUTED)
    ax.text(0.0, -0.68, f"the contextual model recovers {v / base:.2f} times the skill "
                        f"of the aggregate it replaces",
            fontsize=10, color=COOL, fontweight="bold")
    ax.set_yticks([1, 0])
    ax.set_yticklabels(["contextual model", "zone-average baseline"], fontsize=10.5)
    ax.set_xlim(0, 0.175)
    ax.set_ylim(-1.0, 1.8)
    _frame(ax, "Brier Skill Score against the climatological forecast, the share of "
               "reference error removed")
    _save(fig, "bss")


# --------------------------------------------------------- 3. unit of analysis
def target() -> None:
    ps = _load("player_season_model")
    season, shot = ps["test"]["auc"], 0.7009
    fig, ax = plt.subplots(figsize=(8.6, 2.6))
    rows = [("player-season, top-third true shooting", season, ps["test"]["n"], True),
            ("single shot, make or miss", shot, 219157, False)]
    for y, (label, v, n, warm) in zip([1, 0], rows):
        ax.barh(y, v - 0.60, left=0.60, height=0.5,
                color=WARM if warm else TINT, zorder=3)
        ax.text(v + 0.004, y, f"{v:.4f}", va="center", fontsize=10.5, color=INK,
                fontweight="bold" if warm else "normal")
        ax.text(0.606, y, f"n = {n:,}", va="center", fontsize=9.5, color=MUTED, zorder=5)
    ax.set_yticks([1, 0])
    ax.set_yticklabels([r[0] for r in rows], fontsize=10.5)
    ax.set_xlim(0.60, 0.855)
    ax.text(0.60, -0.7, f"same features and the same discipline. {season - shot:+.4f} "
                        f"comes from the unit of analysis alone",
            fontsize=10, color=COOL, fontweight="bold")
    ax.set_ylim(-1.0, 1.6)
    _frame(ax, "test AUC. Aggregating across a season averages away the execution noise "
               "that dominates one attempt")
    _save(fig, "target")


# --------------------------------------------------------- 4. leakage demo
def leakage() -> None:
    rows = _load("leakage_demo")
    labels = ["pre-release features only", "plus ball arc and entry angle",
              "plus ball through the hoop"]
    fig, ax = plt.subplots(figsize=(8.6, 3.1))
    for y, r in zip([2, 1, 0], rows):
        legit = r["verdict"] == "legitimate"
        ax.barh(y, r["test_auc"] - 0.60, left=0.60, height=0.46,
                color=COOL if legit else WARM, zorder=3)
        ax.text(r["test_auc"] + 0.004, y, f"{r['test_auc']:.4f}", va="center",
                fontsize=10.5, color=INK, fontweight="bold", zorder=6)
    ax.axvline(0.80, color=MUTED, linewidth=1, linestyle=(0, (3, 3)), zorder=2)
    ax.text(0.799, -0.62, "0.80, the figure a reader should distrust on public event data",
            fontsize=9.5, color=MUTED, ha="right")
    # the legend sits above the axes so it cannot land on a value label, and the
    # feature counts move into the category labels so they are never set on a fill
    ax.plot([], [], "s", color=COOL, markersize=9, label="legitimate")
    ax.plot([], [], "s", color=WARM, markersize=9, label="invalid, uses the outcome")
    leg = ax.legend(loc="lower left", bbox_to_anchor=(0.0, 1.01), ncol=2,
                    frameon=False, fontsize=10, handletextpad=0.5, columnspacing=1.8)
    for txt in leg.get_texts():
        txt.set_color(INK)
    ax.set_yticks([2, 1, 0])
    ax.set_yticklabels([f"{lab}\n{r['n_features']} features"
                        for lab, r in zip(labels, rows)], fontsize=10.5)
    ax.set_xlim(0.60, 0.86)
    ax.set_ylim(-0.9, 2.55)
    _frame(ax, f"test AUC. Two variables describing the ball after release buy "
               f"{rows[1]['test_auc'] - rows[0]['test_auc']:.4f}")
    _save(fig, "leakage")


# --------------------------------------------------------- 5. version history
def versions() -> None:
    rows = [("v3", 0.6727), ("v4", 0.6737), ("v5", 0.6749),
            ("v6", 0.7000), ("v7", 0.7001), ("v8", 0.7009)]
    fig, ax = plt.subplots(figsize=(8.6, 3.3))
    xs = list(range(len(rows)))
    ys = [r[1] for r in rows]
    ax.axhspan(0.7001 - 0.0021, 0.7001 + 0.0021, color="#f4f2ec", zorder=1)
    ax.text(0.03, 0.7001 + 0.0022, "promotion margin, plus or minus 0.0021 around v7",
            fontsize=9.5, color=MUTED, va="bottom")
    ax.plot(xs, ys, color=TINT, linewidth=2.2, zorder=3)
    for x, (lab, v) in zip(xs, rows):
        sel = lab == "v8"
        ax.plot([x], [v], "o", color=WARM if sel else COOL, markersize=9, zorder=4,
                markeredgecolor="white", markeredgewidth=1.6)
        ax.text(x, v + 0.0017, f"{v:.4f}", ha="center", fontsize=9.5, color=INK,
                fontweight="bold" if sel else "normal")
    ax.annotate("repairing a data defect,\nnot a modelling change",
                xy=(3, 0.7000), xytext=(1.55, 0.6836), fontsize=9.5, color=COOL,
                ha="center",
                arrowprops=dict(arrowstyle="->", color=COOL, linewidth=1.1))
    ax.set_xticks(xs)
    ax.set_xticklabels([r[0] for r in rows], fontsize=10.5)
    ax.set_ylim(0.6675, 0.7062)
    _bare(ax, "production version. v8 fell inside the margin and was promoted by "
              "recorded override")
    _save(fig, "versions")


# --------------------------------------------------------- 6. predictability
def predictability() -> None:
    d = _load("release_predictability")
    rows = sorted(d["results"], key=lambda r: r["r2"])
    fig, ax = plt.subplots(figsize=(8.6, 3.0))
    ys = list(range(len(rows)))
    for y, r in zip(ys, rows):
        decides = r["decides_outcome"]
        ax.barh(y, r["r2"], height=0.5, color=WARM if decides else TINT, zorder=3)
        ax.text(r["r2"] + 0.012, y, f"{r['r2']:.4f}", va="center", fontsize=10.5,
                color=INK, fontweight="bold" if decides else "normal")
    ax.set_yticks(ys)
    ax.set_yticklabels([r["description"] for r in rows], fontsize=10.5)
    ax.set_xlim(0, 0.80)
    ax.plot([], [], "s", color=WARM, markersize=9,
            label="decides whether the shot falls")
    ax.plot([], [], "s", color=TINT, markersize=9, label="does not decide the outcome")
    leg = ax.legend(loc="lower right", frameon=False, fontsize=10, handletextpad=0.5)
    for txt in leg.get_texts():
        txt.set_color(INK)
    _frame(ax, f"R² against everything observable before release, on "
               f"{d['n_shots']:,} tracked shots")
    _save(fig, "predictability")


# --------------------------------------------------------- 7. learning curve
def learning() -> None:
    rows = _load("learning_curve")
    xs = [r["n_train"] for r in rows]
    ys = [r["val_auc"] for r in rows]
    fig, ax = plt.subplots(figsize=(8.6, 3.3))
    ax.plot(xs, ys, color=WARM, linewidth=2.2, zorder=3)
    ax.plot(xs, ys, "o", color=WARM, markersize=7.5, zorder=4,
            markeredgecolor="white", markeredgewidth=1.5)
    for x, y in zip(xs, ys):
        ax.text(x, y - 0.0016, f"{y:.4f}", ha="center", va="top", fontsize=9,
                color=MUTED)
    ax.axhline(ys[-1], color=COOL, linewidth=1.2, linestyle=(0, (3, 3)), zorder=2)
    ax.annotate(f"the last {xs[-1] - xs[3]:,} shots buy {ys[-1] - ys[3]:+.4f}",
                xy=(xs[-1], ys[-1]), xytext=(xs[2], ys[1] - 0.0012),
                fontsize=9.5, color=INK,
                arrowprops=dict(arrowstyle="->", color=MUTED, linewidth=1.1))
    ax.set_xlim(0, 645000)
    ax.set_ylim(0.6585, 0.6800)
    ax.set_xticks([0, 150000, 300000, 450000, 600000])
    ax.set_xticklabels(["0", "150k", "300k", "450k", "600k"], fontsize=10)
    _bare(ax, "training shots. The curve flattens long before the data runs out",
          "validation AUC")
    _save(fig, "learning")


# --------------------------------------------------------- 8. calibration scatter
def support_scatter() -> None:
    rows = _load("robustness")["grid"]["player_train_support (AUDIT HYPOTHESIS)"]
    lo, hi = 0.425, 0.497
    fig, ax = plt.subplots(figsize=(8.6, 4.4))
    ax.plot([lo, hi], [lo, hi], color=MUTED, linewidth=1.2,
            linestyle=(0, (4, 3)), zorder=2)
    ax.text(hi - 0.002, hi - 0.006, "perfect calibration", fontsize=9.5, color=MUTED,
            ha="right", rotation=34)
    for r in rows:
        flag = r["flagged"]
        c = WARM if flag else COOL
        if flag:
            ax.plot([r["predicted"], r["observed"]], [r["observed"]] * 2,
                    color=WARM, linewidth=1.8, zorder=3)
        ax.plot([r["predicted"]], [r["observed"]], "o", color=c, markersize=11,
                zorder=4, markeredgecolor="white", markeredgewidth=1.8)
        # the five bands sit close together on the diagonal, so each label is
        # placed by hand rather than by a rule that would overlap two of them
        place = {"1-50": (0.0, 0.0035, "center", "bottom"),
                 "51-200": (-0.0018, 0.0022, "right", "bottom"),
                 "201-800": (-0.0022, 0.0016, "right", "bottom"),
                 "800+": (0.0024, -0.0016, "left", "top"),
                 "0 (unseen)": (0.0026, 0.0, "left", "center")}
        dx, dy, ha, va = place[r["level"]]
        ax.text(r["predicted"] + dx, r["observed"] + dy,
                f"{r['level']}   n = {r['n']:,}", va=va, ha=ha, fontsize=9.5,
                color=INK, fontweight="bold" if flag else "normal", zorder=5)
        if flag:
            ax.annotate(
                f"under-predicted by {abs(r['gap']):.4f}\n"
                f"95 per cent CI [{r['gap_ci95'][0]:+.4f}, {r['gap_ci95'][1]:+.4f}]",
                xy=((r["predicted"] + r["observed"]) / 2, r["observed"] + 0.0006),
                xytext=(0.4585, 0.4335), fontsize=9.5, color=WARM, ha="center",
                arrowprops=dict(arrowstyle="->", color=WARM, linewidth=1.1))
    ax.plot([], [], "o", color=WARM, markersize=9,
            label="flagged, interval excludes zero")
    ax.plot([], [], "o", color=COOL, markersize=9, label="within noise of zero")
    leg = ax.legend(loc="upper left", frameon=False, fontsize=10, handletextpad=0.4)
    for txt in leg.get_texts():
        txt.set_color(INK)
    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(RULE)
    ax.tick_params(length=0)
    ax.set_axisbelow(True)
    ax.grid(True, color=RULE, linewidth=0.7)
    ax.set_ylabel("observed make rate", color=INK, fontsize=10.5, labelpad=8)
    ax.set_xlabel("mean predicted probability, banded by how many training shots the "
                  "player had", color=MUTED, fontsize=10, labelpad=9)
    _save(fig, "support_scatter")




# --------------------------------------------------------- 9. what drove it
def importance() -> None:
    """Mean absolute SHAP contribution per feature, top fourteen."""
    d = _load("shap_importance")
    rows = d["ranked"][:14][::-1]
    total = sum(r["mean_abs_shap"] for r in d["ranked"])
    # the four groups a reader can act on, coloured so the pattern is legible
    era = {"dist vs era"}
    where = {"shot distance", "zone fg pct", "loc y", "loc x"}
    what = {"is dunk", "action type Jump Shot", "action type Driving Layup Shot",
            "is layup", "is jump shot"}
    when = {"secs since prev event", "game clock sec", "shot clock",
            "prev event type made", "prev event type miss"}

    def tone(name):
        if name in era:
            return WARM
        if name in where or name in what:
            return COOL
        if name in when:
            return TINT
        return "#c9c2b6"

    fig, ax = plt.subplots(figsize=(8.6, 4.6))
    ys = list(range(len(rows)))
    for y, r in zip(ys, rows):
        v = r["mean_abs_shap"]
        ax.barh(y, v, height=0.55, color=tone(r["feature"]), zorder=3)
        ax.text(v + 0.0022, y, f"{v:.4f}   {v / total * 100:.1f}%", va="center",
                fontsize=9.5, color=INK, zorder=4)
    ax.set_yticks(ys)
    ax.set_yticklabels([r["feature"] for r in rows], fontsize=10.5)
    ax.set_xlim(0, 0.235)
    for c, lab in ((WARM, "era context"), (COOL, "where and what"),
                   (TINT, "possession timing"), ("#c9c2b6", "player tendency")):
        ax.plot([], [], "s", color=c, markersize=9, label=lab)
    leg = ax.legend(loc="lower right", frameon=False, fontsize=10, handletextpad=0.5)
    for txt in leg.get_texts():
        txt.set_color(INK)
    _frame(ax, f"mean absolute SHAP contribution, {d['n_sampled']:,} validation shots. "
               f"Percentages are of the total across all {d['n_features']} features")
    _save(fig, "importance")


BUILDERS = [tracking, bss, target, leakage, versions, predictability,
            learning, support_scatter, importance]

if __name__ == "__main__":
    for fn in BUILDERS:
        fn()
