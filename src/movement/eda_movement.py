"""EDA for the movement/trajectory model — writes reports/MOVEMENT_EDA.md + figures.

Model 2 predicts the shooter's PATH into a shot: given the observed prefix of the
trajectory (position, speed, heading, distance-to-basket, distance-to-defender,
has-ball), predict the future positions. This EDA characterises those trajectories
before any modelling: how long/fast they are, how the defender closes in, how
paths differ by move type, and whether the task is learnable (it is — unlike
shot-make, a path is not a coin flip).

CLI:  python -m src.movement.eda_movement
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import get_config

WAYPOINT = ["x", "y", "t", "speed", "heading", "basket_dist", "def_dist", "has_ball"]


def _fig_speed_and_defender(traj, fig_dir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    # mean speed and mean defender distance as a function of normalised path time
    traj = traj.copy()
    traj["phase"] = pd.cut(traj["step"], bins=8, labels=False)
    g = traj.groupby("phase").agg(speed=("speed", "mean"), defd=("def_dist", "mean"))
    fig, ax = plt.subplots(1, 2, figsize=(9, 3.6))
    ax[0].plot(g.index, g["speed"], marker="o", color="#3b82f6")
    ax[0].set_title("Shooter speed over the approach")
    ax[0].set_xlabel("path phase (start → release)")
    ax[0].set_ylabel("speed (ft/s)")
    ax[0].grid(alpha=0.3)
    ax[1].plot(g.index, g["defd"], marker="o", color="#ef4444")
    ax[1].set_title("Closest-defender distance over the approach")
    ax[1].set_xlabel("path phase (start → release)")
    ax[1].set_ylabel("defender distance (ft)")
    ax[1].grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(fig_dir / "movement_eda_kinematics.png", dpi=130)
    plt.close(fig)


def _fig_paths(seq, action, fig_dir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(5.5, 5.5))
    # sample a few trajectories, coloured by 3PT vs 2PT-ish action
    rng = np.random.default_rng(0)
    idx = rng.choice(len(seq), size=min(120, len(seq)), replace=False)
    for i in idx:
        s = seq[i]
        n = np.count_nonzero(~np.all(s == 0, axis=1)) or len(s)
        ax.plot(s[:n, 0], s[:n, 1], lw=0.6, alpha=0.4, color="#3b82f6")
    ax.scatter([5.35], [25.0], c="#ef4444", s=80, marker="*", zorder=5, label="basket")
    ax.set_title("Sample approach paths (2015-16, left half-court)")
    ax.set_xlabel("court x (ft)")
    ax.set_ylabel("court y (ft)")
    ax.legend()
    ax.set_aspect("equal")
    fig.tight_layout()
    fig.savefig(fig_dir / "movement_eda_paths.png", dpi=130)
    plt.close(fig)


def main() -> int:
    cfg = get_config()
    d = np.load(cfg.path("data_movement") / "sequences.npz", allow_pickle=True)
    seq, lengths = d["seq"], d["lengths"]
    game_id, made, action = d["game_id"], d["made"], d["action"]
    traj = pd.read_parquet(cfg.path("data_movement") / "trajectories.parquet")
    fig_dir = cfg.path("figures")

    n = len(seq)
    n_games = len(np.unique(game_id))
    n_players = traj["PLAYER_ID"].nunique()
    total_t = seq[np.arange(n), lengths - 1, 2]  # elapsed time at last real frame
    disp = np.hypot(seq[:, 0, 0] - seq[np.arange(n), lengths - 1, 0],
                    seq[:, 0, 1] - seq[np.arange(n), lengths - 1, 1])
    speeds = traj["speed"].to_numpy()
    speeds = speeds[np.isfinite(speeds)]

    _fig_speed_and_defender(traj, fig_dir)
    _fig_paths(seq, action, fig_dir)

    # move-type proxy = the shot action type
    act = pd.Series(action).str.strip()
    top_actions = act.value_counts().head(8)

    L = [
        "# MOVEMENT_EDA.md — exploratory analysis of shot approach trajectories",
        "",
        f"Model 2 predicts the **path a player takes into a shot**. Dataset: "
        f"**{n:,} trajectories** from {n_games} SportVU games (2015-16), "
        f"{n_players} players. Each trajectory is up to {seq.shape[1]} waypoints "
        f"of 8 features (x, y, t, speed, heading, basket-dist, defender-dist, "
        f"has-ball), sampled at 25 fps and windowed to the ~4 s before release.",
        "",
        "## Why this task IS learnable (unlike shot-make)",
        "A path is continuous and physical — position, velocity and momentum carry",
        "forward — so future positions are genuinely predictable from the observed",
        "prefix. This is a regression task scored in feet (ADE/FDE), not a coin flip;",
        "more data and better sequence models measurably help.",
        "",
        "## Trajectory scale",
        "",
        "| Quantity | median | p10 | p90 |",
        "|---|---|---|---|",
        f"| duration (s) | {np.median(total_t):.2f} | {np.quantile(total_t,0.1):.2f} | {np.quantile(total_t,0.9):.2f} |",
        f"| total displacement (ft) | {np.median(disp):.1f} | {np.quantile(disp,0.1):.1f} | {np.quantile(disp,0.9):.1f} |",
        f"| observed frames (length) | {int(np.median(lengths))} | {int(np.quantile(lengths,0.1))} | {int(np.quantile(lengths,0.9))} |",
        f"| speed (ft/s, per frame) | {np.median(speeds):.1f} | {np.quantile(speeds,0.1):.1f} | {np.quantile(speeds,0.9):.1f} |",
        "",
        "![kinematics](figures/movement_eda_kinematics.png)",
        "",
        "The shooter typically **decelerates into the release** and the **defender",
        "closes in** over the approach — the signal a good model exploits.",
        "",
        "## Move types (by shot action)",
        "",
        "| Action type | trajectories | share |",
        "|---|---|---|",
    ]
    for a, c in top_actions.items():
        L.append(f"| {a} | {c:,} | {c/n:.1%} |")

    L += [
        "",
        "![sample paths](figures/movement_eda_paths.png)",
        "",
        "## Data quality",
        f"- Made shots: {made.mean():.1%} of trajectories (balanced, though the",
        "  movement model does not predict make — that is model 1).",
        "- All trajectories normalised to the LEFT half-court (mirrored if the",
        "  shooter attacked the right basket), so paths are directly comparable.",
        "- Split must be **by GAME** (a game's trajectories share dynamics); a",
        "  possession-level split would leak.",
        "",
        "Modelling detail follows in `reports/MOVEMENT_MODEL_CARD.md`.",
    ]
    (cfg.path("reports") / "MOVEMENT_EDA.md").write_text("\n".join(L), encoding="utf-8")
    print(f"  wrote reports/MOVEMENT_EDA.md ({n:,} trajectories, {n_games} games, "
          f"median duration {np.median(total_t):.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
