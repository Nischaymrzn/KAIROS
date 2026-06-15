"""Train and evaluate the movement models on extracted SportVU trajectories.

Steps
  1. Load `data/movement/sequences.npz`; split 70/15/15 BY GAME (never by
     possession — possessions within a game share dynamics).
  2. Descriptive model: cluster train trajectories into canonical move
     templates (tslearn DTW k-means, KMeans fallback); train a LightGBM
     classifier that predicts the move type from the observed-prefix
     kinematics. Baseline: majority class.
  3. Sequence model: GRU encoder-decoder, observed prefix -> next k positions.
     Baselines: constant-velocity extrapolation AND nearest-centroid replay.
  4. Report ADE / FDE (feet) on held-out games; the GRU must beat both
     baselines. Save artifacts to `models/movement/` + example-path figure.

CLI:  python -m src.movement.train_movement
"""
from __future__ import annotations
import json

import joblib
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from src.config import get_config
from src.seeds import set_global_seed
from src.movement.evaluate_movement import ade, fde, move_type_accuracy, \
    majority_baseline_accuracy
from src.movement.cluster import cluster_trajectories
from src.movement.sequence_model import train_gru, predict_gru


def game_split(game_ids: np.ndarray, seed: int):
    """70/15/15 split over unique games (ordered by id ≈ chronological)."""
    games = np.sort(np.unique(game_ids))
    n = len(games)
    tr, va = games[: int(n * 0.7)], games[int(n * 0.7): int(n * 0.85)]
    te = games[int(n * 0.85):]
    return (np.isin(game_ids, tr), np.isin(game_ids, va), np.isin(game_ids, te))


def prefix_features(seq: np.ndarray, obs: int) -> np.ndarray:
    """Prefix kinematics for the move-type classifier: start/end position,
    displacement, mean/max speed, net heading, basket approach."""
    p = seq[:, :obs]
    return np.column_stack([
        p[:, 0, 0], p[:, 0, 1],            # start x, y
        p[:, -1, 0], p[:, -1, 1],          # end-of-prefix x, y
        p[:, -1, 0] - p[:, 0, 0], p[:, -1, 1] - p[:, 0, 1],
        p[:, 1:, 3].mean(1), p[:, 1:, 3].max(1),      # speed mean / max
        p[:, -1, 4],                        # final heading
        p[:, 0, 5] - p[:, -1, 5],           # basket approach (dist shrunk)
        p[:, :, 6].mean(1),                 # mean defender distance
    ]).astype("float32")


def constant_velocity(seq: np.ndarray, obs: int, horizon: int) -> np.ndarray:
    """Extrapolate the last observed velocity for `horizon` steps."""
    last = seq[:, obs - 1, :2]
    vel = seq[:, obs - 1, :2] - seq[:, obs - 2, :2]
    steps = np.arange(1, horizon + 1, dtype="float32")[None, :, None]
    return last[:, None, :] + vel[:, None, :] * steps


def centroid_replay(seq: np.ndarray, obs: int, centroids: np.ndarray) -> np.ndarray:
    """Assign each prefix to the nearest centroid prefix; replay its suffix,
    shifted to continue from the last observed position."""
    pref = seq[:, :obs, :2].reshape(len(seq), -1)
    cpref = centroids[:, :obs, :2].reshape(len(centroids), -1)
    d = ((pref[:, None, :] - cpref[None, :, :]) ** 2).sum(-1)
    lab = d.argmin(1)
    suffix = centroids[lab, obs:, :2].astype("float32")
    offset = seq[:, obs - 1, :2] - centroids[lab, obs - 1, :2]
    return suffix + offset[:, None, :]


def main() -> int:
    cfg = get_config()
    set_global_seed(cfg.seed)
    mv = cfg.movement
    out_dir = cfg.path("models") / "movement"
    out_dir.mkdir(parents=True, exist_ok=True)

    d = np.load(cfg.path("data_movement") / "sequences.npz", allow_pickle=True)
    seq, game_id = d["seq"].astype("float32"), d["game_id"]
    T = seq.shape[1]
    obs = max(2, int(T * float(mv.obs_frac)))
    horizon = T - obs
    m_tr, m_va, m_te = game_split(game_id, cfg.seed)
    print(f"sequences {seq.shape} | obs {obs} -> predict {horizon} steps | "
          f"games train/val/test: {len(np.unique(game_id[m_tr]))}/"
          f"{len(np.unique(game_id[m_va]))}/{len(np.unique(game_id[m_te]))}")

    # ---- 1. canonical move templates (fit on TRAIN only) ----
    labels_tr, centroids = cluster_trajectories(seq[m_tr], k=int(mv.n_clusters),
                                                seed=cfg.seed)
    centroids = np.asarray(centroids, dtype="float32")
    if centroids.shape[-1] != seq.shape[-1]:   # xy centroids -> pad to feature dim
        pad = np.zeros((*centroids.shape[:2], seq.shape[-1]), "float32")
        pad[:, :, :2] = centroids[:, :, :2]
        centroids = pad

    # assign every sequence to its nearest centroid (xy distance)
    def assign(s):
        flat = s[:, :, :2].reshape(len(s), -1)
        cf = centroids[:, :, :2].reshape(len(centroids), -1)
        return ((flat[:, None] - cf[None]) ** 2).sum(-1).argmin(1)
    y_all = assign(seq)

    # ---- 2. move-type classifier from prefix kinematics ----
    from lightgbm import LGBMClassifier
    X_all = prefix_features(seq, obs)
    clf = LGBMClassifier(n_estimators=400, learning_rate=0.05, num_leaves=31,
                         random_state=cfg.seed, verbose=-1)
    clf.fit(X_all[m_tr], y_all[m_tr])
    acc = move_type_accuracy(clf.predict(X_all[m_te]), y_all[m_te])
    maj = majority_baseline_accuracy(y_all[m_te])
    print(f"move-type accuracy {acc:.3f} vs majority {maj:.3f}")

    # ---- 3. GRU sequence model ----
    target = seq[:, obs:, :2]
    gru, _ = train_gru(seq[m_tr, :obs], target[m_tr],
                       seq[m_va, :obs], target[m_va],
                       hidden=int(mv.gru_hidden), epochs=int(mv.gru_epochs),
                       seed=cfg.seed)

    # ---- 4. evaluation on held-out games ----
    true = target[m_te]
    preds = {
        "gru": predict_gru(gru, seq[m_te, :obs]),
        "constant_velocity": constant_velocity(seq[m_te], obs, horizon),
        "centroid_replay": centroid_replay(seq[m_te], obs, centroids),
    }
    results = {name: {"ade_ft": round(ade(p, true), 3),
                      "fde_ft": round(fde(p, true), 3)}
               for name, p in preds.items()}
    for name, r in results.items():
        print(f"  {name:18} ADE {r['ade_ft']:.2f} ft   FDE {r['fde_ft']:.2f} ft")

    # ---- 5. artifacts ----
    import torch
    torch.save({"state_dict": gru.state_dict(),
                "in_dim": seq.shape[2], "hidden": int(mv.gru_hidden),
                "horizon": horizon, "obs": obs}, out_dir / "gru.pt")
    share = np.bincount(y_all[m_tr], minlength=len(centroids)) / max(m_tr.sum(), 1)
    # medoids: the REAL train trajectory nearest each centroid — physically
    # plausible paths for serving (centroid averages can have jumpy segments)
    medoids = centroids.copy()
    tr_seq, tr_lab = seq[m_tr], y_all[m_tr]
    for k in range(len(centroids)):
        members = tr_seq[tr_lab == k]
        if len(members):
            cf = centroids[k, :, :2].reshape(1, -1)
            mf = members[:, :, :2].reshape(len(members), -1)
            medoids[k] = members[((mf - cf) ** 2).sum(1).argmin()]
    joblib.dump({"centroids": centroids, "medoids": medoids, "classifier": clf,
                 "obs": obs, "cluster_share": share.astype("float32")},
                out_dir / "move_types.joblib")
    metrics = {"n_sequences": int(len(seq)), "obs": obs, "horizon": horizon,
               "move_type_accuracy": round(acc, 4),
               "majority_baseline": round(maj, 4), "trajectory": results}
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))

    # example figure: predicted vs true paths for 6 test shots
    fig, axes = plt.subplots(2, 3, figsize=(13, 8))
    idx = np.linspace(0, true.shape[0] - 1, 6).astype(int)
    for ax, i in zip(axes.ravel(), idx):
        ax.plot(seq[m_te][i, :obs, 0], seq[m_te][i, :obs, 1], "k.-", label="observed")
        ax.plot(true[i, :, 0], true[i, :, 1], "g.-", label="true")
        ax.plot(preds["gru"][i, :, 0], preds["gru"][i, :, 1], "r.--", label="GRU")
        ax.plot(5.35, 25, "o", color="orange", ms=10)
        ax.set_xlim(0, 50); ax.set_ylim(0, 50); ax.set_aspect("equal")
    axes[0, 0].legend(fontsize=8)
    fig.suptitle("Movement model — observed prefix, true path, GRU prediction")
    fig.tight_layout()
    fig.savefig(cfg.path("figures") / "movement_examples.png", dpi=120)
    plt.close(fig)

    # ---- acceptance ----
    assert results["gru"]["ade_ft"] < results["constant_velocity"]["ade_ft"], \
        "GRU does not beat constant velocity"
    assert results["gru"]["ade_ft"] < results["centroid_replay"]["ade_ft"], \
        "GRU does not beat centroid replay"
    assert acc > maj, "move-type classifier does not beat majority"
    print("  ACCEPT: GRU beats both baselines on ADE; move-type beats majority.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
