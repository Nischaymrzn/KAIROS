"""Draw the thesis charts from the recorded results.

These replace hand-authored SVG for the parts of the argument that are actually
data rather than mechanism. A diagram is the right tool for showing how a
pipeline is wired. It is the wrong tool for showing that six zones differ in
discrimination, because then the reader is asked to trust a shape someone drew
rather than read a value that was measured.

Every number here is taken from reports/RESULTS.md and reports/ROBUSTNESS.md and
is quoted in the caption, so a chart and the prose beside it cannot drift.

The palette is two hues, the document accent and a cool counterpart, checked
against the colour-vision, chroma and contrast bounds before use. Grey is used
for reference marks only and never to carry a series, because at this lightness
it fails the chroma floor and would read as a third category that is not there.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

OUT = Path("reports/figures/thesis_charts")

WARM, COOL = "#9a3412", "#2b6cb0"
INK, MUTED, RULE = "#1a1815", "#6b665e", "#e2ddd5"
TINT = "#e7cfc2"

plt.rcParams.update({
    "svg.fonttype": "none",
    "font.family": "Georgia, 'Times New Roman', serif",
    "font.size": 10.5,
    "text.color": INK,
    "axes.edgecolor": RULE,
    "axes.labelcolor": INK,
    "xtick.color": MUTED,
    "ytick.color": INK,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
    "savefig.facecolor": "white",
})


def _frame(ax, xlabel=""):
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(RULE)
    ax.tick_params(length=0)
    ax.set_axisbelow(True)
    ax.xaxis.grid(True, color=RULE, linewidth=0.7)
    ax.yaxis.grid(False)
    if xlabel:
        ax.set_xlabel(xlabel, color=MUTED, fontsize=10, labelpad=9)


# the Word build embeds rasterised figures, and the SVG parser used for the
# hand-drawn ones cannot read matplotlib output, so the PNG is written straight
# from the same figure object at the number the document gives it
# Figure numbers the plotted charts occupy in the document. The Word build
# embeds rasterised figures, and the SVG parser used for the hand-drawn ones
# cannot read matplotlib output, so the PNG is written straight from the same
# figure object. Run svg_to_png.py BEFORE these builders, since it rasterises
# every figure in the document and would otherwise overwrite these with a
# degraded trace of the same chart.
PNG_AT = {
    # build_thesis_charts
    "families": 37, "zones": 38, "murphy": 42, "nulls": 50, "support": 54,
    # build_more_charts
    "tracking": 25, "bss": 32, "importance": 41, "predictability": 45,
    "target": 46, "leakage": 47, "learning": 48, "versions": 49,
    "support_scatter": 53,
    # build_reader_charts
    "spread": 33, "reliability": 34, "drift": 35, "court": 40, "defender": 52,
}
PNG_DIR = Path("reports/figures/thesis_png")


def _save(fig, name):
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"{name}.svg"
    fig.savefig(p, format="svg", bbox_inches="tight", pad_inches=0.18)
    if name in PNG_AT:
        PNG_DIR.mkdir(parents=True, exist_ok=True)
        fig.savefig(PNG_DIR / f"Figure{PNG_AT[name]}.png", format="png", dpi=200,
                    bbox_inches="tight", pad_inches=0.18)
    plt.close(fig)
    print(f"  {p}")


# ---------------------------------------------------------------- 1. families
def families():
    # read from the frozen production bundle rather than transcribing, since the
    # transcribed values were left behind at v7 and disagreed with the table in
    # the same section of the document
    import json
    lb = json.loads(Path("models/production/v8/leaderboard.json").read_text())
    label = {"catboost": "CatBoost", "xgboost": "XGBoost",
             "fttransformer": "FT-Transformer", "lightgbm": "LightGBM",
             "mlp": "Tabular MLP", "rf": "Random Forest", "tabnet": "TabNet",
             "logreg": "Logistic Regression"}
    ranked = sorted(lb["models"], key=lambda m: m["auc"], reverse=True)
    rows = [(label[m["name"]], m["auc"], i == 0) for i, m in enumerate(ranked)]
    base = lb["baseline_val_auc"]
    rows = rows[::-1]
    fig, ax = plt.subplots(figsize=(8.6, 4.3))
    ys = range(len(rows))
    for y, (name, v, sel) in zip(ys, rows):
        ax.barh(y, v - 0.60, left=0.60, height=0.52,
                color=WARM if sel else TINT, zorder=3)
        ax.text(v + 0.0015, y, f"{v:.4f}", va="center", ha="left",
                fontsize=10, color=INK, zorder=4,
                fontweight="bold" if sel else "normal")
    ax.axvline(base, color=COOL, linewidth=1.6, zorder=5)
    ax.text(base - 0.0018, len(rows) - 0.35, f"zone-average baseline  {base:.4f}",
            ha="right", va="center", fontsize=10, color=COOL, fontweight="bold")
    ax.set_yticks(list(ys))
    ax.set_yticklabels([r[0] for r in rows], fontsize=10.5)
    ax.set_xlim(0.60, 0.712)
    _frame(ax, "validation AUC, 2024-25 season, identical features and splits")
    _save(fig, "families")


# ---------------------------------------------------------------- 2. zones
def zones():
    rows = [
        ("Restricted area", 62250, 0.7255), ("Paint, non-restricted", 43908, 0.6351),
        ("Mid-range", 22025, 0.6142), ("Right corner three", 11360, 0.6059),
        ("Left corner three", 12210, 0.6044), ("Above the break three", 67375, 0.5955),
    ][::-1]
    fig, ax = plt.subplots(figsize=(8.6, 3.5))
    ys = range(len(rows))
    for y, (name, n, v) in zip(ys, rows):
        ax.barh(y, v - 0.55, left=0.55, height=0.52, color=TINT, zorder=3)
        ax.text(v + 0.0025, y, f"{v:.4f}", va="center", fontsize=10, color=INK, zorder=4)
        ax.text(0.556, y, f"n = {n:,}", va="center", fontsize=9.5, color=MUTED, zorder=5)
    ax.barh(len(rows) - 1, rows[-1][2] - 0.55, left=0.55, height=0.52,
            color=WARM, zorder=3)
    ax.axvline(0.7009, color=COOL, linewidth=1.6, zorder=5)
    ax.text(0.7009 + 0.003, 0.1, "aggregate  0.7009", fontsize=10,
            color=COOL, fontweight="bold", va="center")
    ax.set_yticks(list(ys))
    ax.set_yticklabels([r[0] for r in rows], fontsize=10.5)
    ax.set_xlim(0.55, 0.755)
    _frame(ax, "test AUC by court zone, 2025-26 season read once")
    _save(fig, "zones")


# ---------------------------------------------------------------- 3. support
def support():
    rows = [
        ("1 to 50 attempts", 6340, -0.0277, -0.0395, -0.0169, True),
        ("51 to 200", 7887, -0.0085, -0.0191, 0.0032, False),
        ("201 to 800", 29537, -0.0019, -0.0075, 0.0033, False),
        ("more than 800", 131346, 0.0011, -0.0013, 0.0037, False),
        ("never seen in training", 44047, 0.0012, -0.0029, 0.0055, False),
    ][::-1]
    fig, ax = plt.subplots(figsize=(8.6, 3.4))
    ys = list(range(len(rows)))
    ax.axvline(0, color=MUTED, linewidth=1.2, zorder=2)
    for y, (name, n, gap, lo, hi, flag) in zip(ys, rows):
        c = WARM if flag else COOL
        ax.plot([lo, hi], [y, y], color=c, linewidth=2, solid_capstyle="round", zorder=3)
        ax.plot([gap], [y], "o", color=c, markersize=9, zorder=4,
                markeredgecolor="white", markeredgewidth=1.6)
        ax.text(hi + 0.0016, y, f"{gap:+.4f}", va="center", fontsize=10,
                color=INK, fontweight="bold" if flag else "normal", zorder=5)
        ax.text(-0.0455, y, f"n = {n:,}", va="center", fontsize=9.5, color=MUTED)
    ax.set_yticks(ys)
    ax.set_yticklabels([r[0] for r in rows], fontsize=10.5)
    ax.set_xlim(-0.047, 0.013)
    # colour here carries status, flagged against not flagged, so it must not also
    # be read as direction. The sign is stated on the axis instead, and the one
    # flagged band is named in a legend rather than left to the hue alone.
    ax.plot([], [], "o", color=WARM, markersize=8, label="flagged, interval excludes zero")
    ax.plot([], [], "o", color=COOL, markersize=8, label="within noise of zero")
    leg = ax.legend(loc="upper left", bbox_to_anchor=(0.0, 1.16), ncol=2,
                    frameon=False, fontsize=10, handletextpad=0.4, columnspacing=1.6)
    for txt in leg.get_texts():
        txt.set_color(INK)
    # sign convention follows src/models/robustness.py, gap = predicted - observed,
    # so a negative gap is the model predicting fewer makes than actually fell
    _frame(ax, "calibration gap, predicted minus observed. Negative means the model "
               "predicts fewer makes than occurred. 95 per cent bootstrap intervals")
    _save(fig, "support")


# ---------------------------------------------------------------- 4. murphy
def murphy():
    # read from the recorded decomposition rather than transcribing it, since the
    # transcribed resolution had drifted to 0.0358 against a recorded 0.0352
    import json
    m = json.loads(Path("reports/figures/skill_score.json").read_text())["murphy"]
    unc, res, rel = m["uncertainty"], m["resolution"], m["reliability"]
    fig, ax = plt.subplots(figsize=(8.6, 2.2))
    ax.barh(0, unc, height=0.46, color=TINT, zorder=3)
    ax.barh(0, res, left=unc - res, height=0.46, color=WARM, zorder=4)
    ax.text(unc / 2, 0.42, f"irreducible uncertainty  {unc:.4f}", ha="center",
            fontsize=10.5, color=INK)
    ax.annotate(f"resolution, what the model removes  {res:.4f}",
                xy=(unc - res / 2, -0.30), xytext=(unc - res / 2, -0.62),
                ha="center", fontsize=10.5, color=WARM, fontweight="bold",
                arrowprops=dict(arrowstyle="-", color=WARM, linewidth=1.2))
    ax.text(0.2515, 0, f"reliability {rel:.4f}", va="center", fontsize=10, color=MUTED)
    ax.set_yticks([])
    ax.set_ylim(-0.95, 0.72)
    ax.set_xlim(0, 0.30)
    _frame(ax, "Brier score of the base rate, partitioned after Murphy (1973)")
    _save(fig, "murphy")


# ---------------------------------------------------------------- 5. nulls
def nulls():
    rows = [
        ("Score margin and opponent context", -0.0001),
        ("In-game rhythm, the hot hand", 0.0002),
        ("Rest and back-to-back scheduling", -0.0002),
        ("Combine athleticism", -0.0003),
        ("Prior-season aggregates", 0.00006),
        ("Six tracking measures, best of", 0.00052),
        ("Empirical-Bayes skill shrinkage", -0.00010),
        ("Native categoricals with player identity", -0.00018),
        ("Zone-specific opponent defence", -0.00254),
        ("Hyperparameter search, 55 trials", 0.0007),
        ("Stacked ensemble of six models", 0.0004),
        ("Era features and recency weighting", 0.0008),
    ][::-1]
    fig, ax = plt.subplots(figsize=(8.6, 4.2))
    ys = list(range(len(rows)))
    ax.axvspan(-0.001, 0.001, color="#f4f2ec", zorder=1)
    ax.axvline(0, color=MUTED, linewidth=1.2, zorder=2)
    for y, (name, d) in zip(ys, rows):
        adopted = name.startswith("Era features")
        c = WARM if adopted else COOL
        ax.plot([0, d], [y, y], color=c, linewidth=1.8, solid_capstyle="butt", zorder=3)
        ax.plot([d], [y], "o", color=c, markersize=8, zorder=4,
                markeredgecolor="white", markeredgewidth=1.5)
    ax.text(0, len(rows) - 0.2, "the shaded band is the noise floor, plus or minus 0.001",
            ha="center", fontsize=9.5, color=MUTED)
    ax.set_yticks(ys)
    ax.set_yticklabels([r[0] for r in rows], fontsize=10.5)
    ax.set_xlim(-0.0031, 0.0016)
    _frame(ax, "change in validation AUC, each measured against a bar fixed before the run")
    _save(fig, "nulls")


if __name__ == "__main__":
    families()
    zones()
    support()
    murphy()
    nulls()
