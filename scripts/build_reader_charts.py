"""Five charts a non-specialist can read at a glance.

The findings sections carried the evidence but several of the claims a reader most
wants to check had no picture at all. Calibration was reported as a single number
with no curve. The spread of shot difficulty, which is the whole argument against
field-goal percentage, was asserted rather than shown. Zone results sat in a bar
chart with no court. And the defender relationship, which is the central mitigation
in the ethical section, existed only as two numbers in a sentence.

Every value is computed from a recorded file. The calibration bins come from
reports/figures/skill_score.json, the zone results from reports/RESULTS.md, and the
defender relationship from the 2014-15 public shot logs, which is observed data
rather than model output.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Arc, Circle, Rectangle  # noqa: E402

from build_thesis_charts import (  # noqa: E402
    WARM, COOL, INK, MUTED, RULE, TINT, _frame, _save,
)

REPORTS = Path("reports/figures")
SHOT_LOGS = Path("data/shot_data/shot_logs.csv")


def _skill():
    return json.loads((REPORTS / "skill_score.json").read_text())


# ------------------------------------------------- 1. reliability diagram
def reliability() -> None:
    """Does a stated 60 per cent actually happen 60 per cent of the time."""
    d = _skill()
    bins = sorted(d["murphy"]["bins"], key=lambda b: b["mean_forecast"])
    xs = [b["mean_forecast"] for b in bins]
    ys = [b["observed_rate"] for b in bins]
    ns = [b["n"] for b in bins]
    fig, ax = plt.subplots(figsize=(8.6, 4.6))
    ax.plot([0, 1], [0, 1], color=MUTED, linewidth=1.2, linestyle=(0, (4, 3)), zorder=2)
    ax.text(0.86, 0.83, "perfect calibration", fontsize=10, color=MUTED,
            rotation=38, ha="center")
    smax = max(ns)
    ax.plot(xs, ys, color=TINT, linewidth=1.6, zorder=3)
    for x, y, n in zip(xs, ys, ns):
        ax.plot([x], [y], "o", color=WARM, zorder=4,
                markersize=5 + 9 * (n / smax) ** 0.5,
                markeredgecolor="white", markeredgewidth=1.2)
    ax.text(0.04, 0.92, f"expected calibration error {d['ece']:.4f}", fontsize=11,
            color=INK, fontweight="bold")
    ax.text(0.04, 0.865, f"{d['n']:,} shots in {len(bins)} bins, marker area is bin size",
            fontsize=9.5, color=MUTED)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_ylabel("observed make rate", color=INK, fontsize=10.5, labelpad=8)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(RULE)
    ax.tick_params(length=0)
    ax.set_axisbelow(True)
    ax.grid(True, color=RULE, linewidth=0.7)
    ax.set_xlabel("what the model said would happen", color=MUTED, fontsize=10,
                  labelpad=9)
    _save(fig, "reliability")


# ------------------------------------------------- 2. spread of difficulty
def spread() -> None:
    """The range of difficulty that field-goal percentage collapses into one number."""
    d = _skill()
    bins = sorted(d["murphy"]["bins"], key=lambda b: b["mean_forecast"])
    xs = [b["mean_forecast"] for b in bins]
    ns = [b["n"] for b in bins]
    total = sum(ns)
    base = d["base_rate"]
    fig, ax = plt.subplots(figsize=(8.6, 3.9))
    ax.bar(xs, [n / total * 100 for n in ns], width=0.042, color=TINT, zorder=3)
    ax.axvline(base, color=COOL, linewidth=1.6, zorder=5)
    ax.text(base + 0.012, max(n / total * 100 for n in ns) * 0.92,
            f"league average\n{base:.3f}", fontsize=10, color=COOL, fontweight="bold")
    lo, hi = xs[0], xs[-1]
    ax.annotate("", xy=(lo, -0.55), xytext=(hi, -0.55), annotation_clip=False,
                arrowprops=dict(arrowstyle="<->", color=WARM, linewidth=1.4))
    ax.text((lo + hi) / 2, -1.15, f"every attempt between {lo:.2f} and {hi:.2f} counts "
                                  f"as exactly one shot in a field-goal percentage",
            ha="center", fontsize=10, color=WARM, fontweight="bold", clip_on=False)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, max(n / total * 100 for n in ns) * 1.12)
    _frame(ax, "")
    ax.set_ylabel("per cent of shots", color=INK, fontsize=10.5, labelpad=8)
    ax.set_xlabel("difficulty the model assigns, as a make probability",
                  color=MUTED, fontsize=10, labelpad=26)
    _save(fig, "spread")


# ------------------------------------------------- 3. the court, by zone
ZONES = [
    ("Restricted area", 0.7255, 62250, (0.0, 5.2), "rim"),
    ("Paint, non-restricted", 0.6351, 43908, (0.0, 13.0), "paint"),
    ("Mid-range", 0.6142, 22025, (0.0, 20.5), "mid"),
    ("Left corner three", 0.6044, 12210, (-21.0, 5.0), "corner"),
    ("Right corner three", 0.6059, 11360, (21.0, 5.0), "corner"),
    ("Above the break three", 0.5955, 67375, (0.0, 28.5), "arc"),
]


def court() -> None:
    """Discrimination drawn on the floor it refers to."""
    lo, hi = 0.58, 0.74
    fig, ax = plt.subplots(figsize=(8.6, 5.4))

    def shade(v):
        # one hue, light to dark, so magnitude reads without a second colour
        f = (v - lo) / (hi - lo)
        return (1 - 0.62 * f, 1 - 0.78 * f, 1 - 0.80 * f)

    # half court, drawn to NBA proportions in feet
    ax.add_patch(Rectangle((-25, 0), 50, 47, fill=False, ec=RULE, lw=1.4))
    ax.add_patch(Rectangle((-8, 0), 16, 19, fill=False, ec=RULE, lw=1.2))
    ax.add_patch(Circle((0, 19), 6, fill=False, ec=RULE, lw=1.2))
    ax.add_patch(Circle((0, 5.25), 0.75, fill=False, ec=INK, lw=1.4))
    ax.add_patch(Arc((0, 5.25), 8, 8, theta1=0, theta2=180, ec=RULE, lw=1.2))
    ax.plot([-22, -22], [0, 14], color=RULE, lw=1.2)
    ax.plot([22, 22], [0, 14], color=RULE, lw=1.2)
    ax.add_patch(Arc((0, 5.25), 47.5, 47.5, theta1=22, theta2=158, ec=RULE, lw=1.2))

    for name, auc, n, (x, y), kind in ZONES:
        c = shade(auc)
        ax.add_patch(Circle((x, y), 3.1, facecolor=c, edgecolor="white", lw=1.6,
                            zorder=4))
        ax.text(x, y + 0.55, f"{auc:.3f}", ha="center", va="center", fontsize=10.5,
                color="white" if auc > 0.66 else INK, fontweight="bold", zorder=5)
        ax.text(x, y - 1.35, f"n={n // 1000}k", ha="center", va="center", fontsize=8.5,
                color="white" if auc > 0.66 else MUTED, zorder=5)
        ty = y + 4.6 if kind != "corner" else y + 4.6
        ax.text(x, ty, name, ha="center", va="center", fontsize=10, color=INK, zorder=5)

    ax.text(-24, 44.5, "HOW WELL THE MODEL SEPARATES A MAKE FROM A MISS, BY ZONE",
            fontsize=9.5, color=WARM, fontweight="bold")
    ax.text(-24, 41.6, "darker is better. The model is strongest at the rim, where a "
                       "coach needs least help,", fontsize=10, color=MUTED)
    ax.text(-24, 39.4, "and weakest above the arc, which is also the busiest zone on "
                       "the floor.", fontsize=10, color=MUTED)
    ax.set_xlim(-26, 26)
    ax.set_ylim(-1, 47)
    ax.set_aspect("equal")
    ax.axis("off")
    _save(fig, "court")


# ------------------------------------------------- 4. where it drifts
def drift() -> None:
    """Calibration gap across the probability range, against the noise band."""
    d = _skill()
    bins = sorted(d["murphy"]["bins"], key=lambda b: b["mean_forecast"])
    xs = [b["mean_forecast"] for b in bins]
    gaps = [b["mean_forecast"] - b["observed_rate"] for b in bins]
    fig, ax = plt.subplots(figsize=(8.6, 3.6))
    ax.axhspan(-0.01, 0.01, color="#f4f2ec", zorder=1)
    ax.axhline(0, color=MUTED, linewidth=1.2, zorder=2)
    for x, g in zip(xs, gaps):
        ax.plot([x, x], [0, g], color=TINT, linewidth=1.6, zorder=3)
        ax.plot([x], [g], "o", color=WARM if abs(g) > 0.01 else COOL, markersize=7.5,
                zorder=4, markeredgecolor="white", markeredgewidth=1.3)
    worst = max(bins, key=lambda b: abs(b["mean_forecast"] - b["observed_rate"]))
    wg = worst["mean_forecast"] - worst["observed_rate"]
    ax.annotate(f"largest drift {wg:+.4f}\nat a stated "
                f"{worst['mean_forecast']:.2f}",
                xy=(worst["mean_forecast"], wg), xytext=(0.34, 0.031),
                fontsize=9.5, color=INK,
                arrowprops=dict(arrowstyle="->", color=MUTED, linewidth=1.1))
    ax.text(0.015, 0.0115, "shaded band is one percentage point either way",
            fontsize=9.5, color=MUTED, va="bottom")
    ax.set_xlim(0, 1)
    ax.set_ylim(-0.042, 0.042)
    _frame(ax, "what the model said would happen")
    ax.set_ylabel("said minus happened", color=INK, fontsize=10.5, labelpad=8)
    _save(fig, "drift")


# ------------------------------------------------- 5. the defender, observed
def defender() -> None:
    """Observed make rate against closest defender distance, 2014-15 shot logs."""
    import pandas as pd
    cols = ["CLOSE_DEF_DIST", "PTS_TYPE", "FGM"]
    df = pd.read_csv(SHOT_LOGS, usecols=cols)
    df = df[(df["CLOSE_DEF_DIST"] >= 0) & (df["CLOSE_DEF_DIST"] <= 10)]
    edges = [0, 1, 2, 3, 4, 5, 6, 8, 10]
    df["band"] = pd.cut(df["CLOSE_DEF_DIST"], bins=edges, right=False)
    fig, ax = plt.subplots(figsize=(8.6, 4.2))
    out = {}
    for pts, colour, label in ((2, COOL, "two-point attempts"),
                               (3, WARM, "three-point attempts")):
        sub = df[df["PTS_TYPE"] == pts].groupby("band", observed=True)["FGM"]
        rate, n = sub.mean(), sub.size()
        xs = [(e.left + e.right) / 2 for e in rate.index]
        ax.plot(xs, rate.values, color=colour, linewidth=2.2, zorder=3)
        ax.plot(xs, rate.values, "o", color=colour, markersize=7, zorder=4,
                markeredgecolor="white", markeredgewidth=1.4, label=label)
        out[pts] = (xs, list(rate.values), list(n.values))
    for pts, dy in ((2, 0.018), (3, -0.030)):
        xs, ys, _ = out[pts]
        ax.text(xs[0], ys[0] + dy, f"{ys[0]:.3f}", fontsize=9.5, color=INK, ha="center")
        ax.text(xs[-1], ys[-1] + dy, f"{ys[-1]:.3f}", fontsize=9.5, color=INK,
                ha="center")
    g2 = out[2][1][-1] - out[2][1][0]
    g3 = out[3][1][-1] - out[3][1][0]
    ax.text(0.35, 0.638, f"going from smothered to open is worth {g3:+.3f} on a three\n"
                         f"and {g2:+.3f} on a two, because a layup is taken into contact "
                         f"by design", fontsize=10, color=INK)
    leg = ax.legend(loc="lower right", frameon=False, fontsize=10, handletextpad=0.5)
    for txt in leg.get_texts():
        txt.set_color(INK)
    ax.set_xlim(0, 10)
    # the tightest three-point band sits near 0.20, so the floor must clear it
    ax.set_ylim(0.16, 0.70)
    _frame(ax, f"closest defender distance in feet, {len(df):,} attempts from the "
               f"2014-15 public shot logs")
    ax.set_ylabel("observed make rate", color=INK, fontsize=10.5, labelpad=8)
    _save(fig, "defender")


BUILDERS = [reliability, spread, court, drift, defender]

if __name__ == "__main__":
    for fn in BUILDERS:
        fn()
