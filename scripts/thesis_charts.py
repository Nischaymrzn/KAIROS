"""Render the thesis infographics as images for the Word build.

The HTML carries these as inline SVG, which survives no HTML to DOCX path. An
earlier build fell back to plain tables, which lost the comparison each chart
exists to make: a table of R squared values does not show that entry angle is
almost unpredictable while apex height is not.

Every figure here comes from a measurement reported in the thesis. Nothing is
illustrative. Output is 200 dpi PNG sized for a 6.3 inch text column.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

OUT = Path("reports/figures/thesis")

INK = "#1a1815"
MUTED = "#6b665e"
RULE = "#d8d2c9"
ACCENT = "#9a3412"
TEAL = "#1e5f74"
RED = "#8c2f39"
PAPER = "#ffffff"

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["Georgia", "DejaVu Serif"],
    "text.color": INK,
    "axes.labelcolor": INK,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "axes.edgecolor": RULE,
    "figure.facecolor": PAPER,
    "axes.facecolor": PAPER,
    "savefig.facecolor": PAPER,
})


def _save(fig, name: str) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"{name}.png"
    fig.savefig(p, dpi=200, bbox_inches="tight", pad_inches=0.12)
    plt.close(fig)
    return p


def murphy() -> Path:
    """The Brier partition drawn to scale, which is the whole point of it."""
    fig, ax = plt.subplots(figsize=(6.3, 1.55))
    unc, res, rel = 0.2492, 0.0349, 0.0001
    ax.barh([0], [unc], color=RULE, edgecolor=RULE, height=0.55)
    ax.barh([0], [res], left=[unc], color=TEAL, edgecolor=TEAL, height=0.55)
    ax.barh([0], [max(rel, 0.0012)], left=[unc + res], color=ACCENT, edgecolor=ACCENT, height=0.55)

    ax.text(unc / 2, 0, "0.2492  irreducible", ha="center", va="center", fontsize=9, color=INK)
    ax.text(unc + res / 2, -0.52, "0.0349\nextracted", ha="center", va="top", fontsize=8, color=TEAL)
    ax.text(unc + res + 0.004, 0.5, "reliability 0.0001", ha="left", va="center",
            fontsize=7.5, color=ACCENT)

    ax.set_xlim(0, 0.30)
    ax.set_ylim(-1.3, 0.9)
    ax.set_yticks([])
    ax.set_xlabel("Brier score contribution", fontsize=8.5)
    ax.tick_params(labelsize=8)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    return _save(fig, "murphy")


def families() -> Path:
    data = [("Logistic regression", .6707, 19), ("TabNet", .6856, 365),
            ("Random forest", .6894, 345), ("Tabular MLP", .6920, 455),
            ("LightGBM", .6963, 82), ("FT-Transformer", .6967, 3054),
            ("XGBoost", .6970, 35), ("CatBoost", .6976, 117)]
    names = [d[0] for d in data]
    aucs = [d[1] for d in data]
    secs = [d[2] for d in data]

    fig, ax = plt.subplots(figsize=(6.3, 3.0))
    colours = [ACCENT if n == "CatBoost" else TEAL for n in names]
    ax.barh(names, aucs, color=colours, alpha=.85, height=.62)
    ax.axvline(.6335, color=RED, ls="--", lw=1.1)
    ax.text(.6339, -0.85, "xP baseline 0.6335", color=RED, fontsize=8, va="center")

    for i, (a, s) in enumerate(zip(aucs, secs)):
        ax.text(a + .0006, i, f"{a:.4f}", va="center", fontsize=8, color=INK)
        ax.scatter([.7045], [i], s=max(8, s ** 0.62), color=MUTED, alpha=.35)

    ax.text(.7045, len(names) - 0.3, "train time", ha="center", fontsize=7.5, color=MUTED)
    ax.set_xlim(.628, .707)
    ax.set_xlabel("Validation AUC", fontsize=8.5)
    ax.tick_params(labelsize=8.5)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    return _save(fig, "families")


def ceiling() -> Path:
    labels = ["Entry angle", "Min. distance\nto rim", "Flight time", "Apex height"]
    vals = [0.046, 0.363, 0.561, 0.612]
    decides = [True, True, False, False]

    fig, ax = plt.subplots(figsize=(6.3, 2.2))
    colours = [RED if d else TEAL for d in decides]
    ax.barh(labels, vals, color=colours, alpha=.85, height=.6)
    for i, v in enumerate(vals):
        ax.text(v + .012, i, f"{v:.3f}", va="center", fontsize=8.5, color=INK)

    ax.set_xlim(0, 0.72)
    ax.set_xlabel("R² predicting the quantity from pre-release context", fontsize=8.5)
    ax.tick_params(labelsize=8.5)
    ax.legend(handles=[Patch(color=RED, alpha=.85, label="decides whether the shot falls"),
                       Patch(color=TEAL, alpha=.85, label="follows the ballistic envelope")],
              fontsize=7.5, frameon=False, loc="lower right")
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    return _save(fig, "ceiling")


def contrast() -> Path:
    fig, ax = plt.subplots(figsize=(6.3, 1.9))
    ax.bar(["Single shot\n219,157 attempts", "Player season\n1,172 player-seasons"],
           [0.7001, 0.8099], color=[TEAL, ACCENT], alpha=.88, width=.45)
    for i, v in enumerate([0.7001, 0.8099]):
        ax.text(i, v + .008, f"{v:.4f}", ha="center", fontsize=11, fontweight="bold", color=INK)
    ax.set_ylim(0.5, 0.88)
    ax.set_ylabel("AUC", fontsize=8.5)
    ax.tick_params(labelsize=8.5)
    ax.text(0.5, 0.53, "same pipeline, same validation discipline", ha="center",
            fontsize=8, color=MUTED, style="italic", transform=ax.transData)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    return _save(fig, "contrast")


def zones() -> Path:
    data = [("Above the break 3", .5953), ("Left corner 3", .6031), ("Right corner 3", .6047),
            ("Mid-range", .6130), ("Paint, non-RA", .6349), ("Restricted area", .7247)]
    names = [d[0] for d in data]
    vals = [d[1] for d in data]

    fig, ax = plt.subplots(figsize=(6.3, 2.4))
    colours = [ACCENT if v > .70 else TEAL for v in vals]
    ax.barh(names, vals, color=colours, alpha=.85, height=.62)
    ax.axvline(.7001, color=MUTED, ls="--", lw=1.1)
    ax.text(.7015, -0.8, "aggregate 0.7001", color=MUTED, fontsize=8, va="center")
    for i, v in enumerate(vals):
        ax.text(v + .002, i, f"{v:.4f}", va="center", fontsize=8, color=INK)

    ax.set_xlim(.55, .755)
    ax.set_xlabel("AUC on the held-out season", fontsize=8.5)
    ax.tick_params(labelsize=8.5)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    return _save(fig, "zones")


def research_cycle() -> Path:
    fig, ax = plt.subplots(figsize=(6.3, 1.5))
    stages = ["1. Question\none testable claim", "2. Implement\nsmallest change",
              "3. Measure\nvalidation season", "4. Decide\nkeep or record null"]
    for i, s in enumerate(stages):
        ax.add_patch(plt.Rectangle((i * 2.5, 0), 2.1, 1, fill=False, ec=ACCENT, lw=1.1))
        ax.text(i * 2.5 + 1.05, .5, s, ha="center", va="center", fontsize=8, color=INK)
        if i < 3:
            ax.annotate("", xy=(i * 2.5 + 2.45, .5), xytext=(i * 2.5 + 2.15, .5),
                        arrowprops=dict(arrowstyle="->", color=ACCENT, lw=1.1))
    ax.annotate("", xy=(1.05, -0.05), xytext=(8.55, -0.55),
                arrowprops=dict(arrowstyle="->", color=ACCENT, lw=1, ls="--",
                                connectionstyle="arc3,rad=0.06"))
    ax.text(4.8, -0.78, "every outcome logged, including the nulls",
            ha="center", fontsize=7.5, color=MUTED, style="italic")
    ax.set_xlim(-0.3, 9.6)
    ax.set_ylim(-1.05, 1.2)
    ax.axis("off")
    return _save(fig, "cycle")


def architecture() -> Path:
    layers = [("5  Presentation", "Dashboard, 3D scenario builder", "no modelling logic"),
              ("4  Serving", "Inference, explanation, ranking, contest, movement", "one prediction path"),
              ("3  Modelling", "Eight families, isotonic calibration, frozen bundle", "config hash recorded"),
              ("2  Features", "Spatial, temporal, shot type, player, possession", "train-only statistics"),
              ("1  Acquisition", "Shot records, play-by-play, API, tracking, profiles", "validated on overlap")]
    fig, ax = plt.subplots(figsize=(6.3, 2.6))
    for i, (name, body, disc) in enumerate(layers):
        ax.add_patch(plt.Rectangle((0, i * 1.12), 10, .92, fill=False, ec=ACCENT, lw=1))
        ax.text(.22, i * 1.12 + .62, name, fontsize=8, fontweight="bold", color=INK)
        ax.text(.22, i * 1.12 + .26, body, fontsize=7.5, color=INK)
        ax.text(9.78, i * 1.12 + .44, disc, fontsize=7, color=MUTED, ha="right", style="italic")
        if i < len(layers) - 1:
            ax.annotate("", xy=(5, i * 1.12 + 1.10), xytext=(5, i * 1.12 + 0.96),
                        arrowprops=dict(arrowstyle="<-", color=ACCENT, lw=1))
    ax.set_xlim(-.15, 10.15)
    ax.set_ylim(-.15, len(layers) * 1.12)
    ax.axis("off")
    return _save(fig, "architecture")


BUILDERS = {
    "Infographic 1": murphy, "Infographic 2": families, "Infographic 3": ceiling,
    "Infographic 4": contrast, "Infographic 5": zones,
    "Figure 1": research_cycle, "Figure 2": architecture,
}


def build_all() -> dict[str, Path]:
    return {k: fn() for k, fn in BUILDERS.items()}


if __name__ == "__main__":
    for k, v in build_all().items():
        print(f"  {k:16} -> {v}")
