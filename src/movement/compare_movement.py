"""Model 2 comparison — trajectory prediction across five approaches on one
game-level split, scored by ADE/FDE (feet). The deep-learning bake-off for the
movement model, mirroring model 1's 8-family comparison.

  constant_velocity  — extrapolate the last observed velocity (physics baseline)
  centroid_replay    — replay the nearest canonical move template
  GRU  enc-dec       — recurrent, teacher-forced (the previous model)
  LSTM enc-dec       — recurrent with gated memory
  Transformer        — encoder + query decoder, cross-attention

Split is BY GAME (a game's trajectories share dynamics — a possession split would
leak). The best model on validation ADE is retrained-agnostic (already trained)
and saved to models/movement/ with its architecture tag, and the served layer
loads by tag.

CLI:  python -m src.movement.compare_movement
Outputs: models/movement/{best model}.pt + comparison.json, reports figure.
"""
from __future__ import annotations
import json

import numpy as np
import torch

from src.config import get_config
from src.seeds import set_global_seed
from src.movement.evaluate_movement import (ade, fde, move_type_accuracy,
                                            majority_baseline_accuracy)
from src.movement.cluster import cluster_trajectories
from src.movement.train_movement import (game_split, prefix_features,
                                         constant_velocity, centroid_replay)
from src.movement.sequence_model import TrajectoryGRU
from src.movement.seq_models import (TrajectoryLSTM, TrajectoryTransformer,
                                     train_seq, predict_seq)


def _centroids(seq, m_tr, k, seed):
    labels_tr, cents = cluster_trajectories(seq[m_tr], k=k, seed=seed)
    cents = np.asarray(cents, dtype="float32")
    if cents.shape[-1] != seq.shape[-1]:
        pad = np.zeros((*cents.shape[:2], seq.shape[-1]), "float32")
        pad[:, :, :2] = cents[:, :, :2]
        cents = pad
    return cents


def main() -> int:
    cfg = get_config()
    set_global_seed(cfg.seed)
    mv = cfg.movement
    out = cfg.path("models") / "movement"
    out.mkdir(parents=True, exist_ok=True)

    d = np.load(cfg.path("data_movement") / "sequences.npz", allow_pickle=True)
    seq, game_id = d["seq"].astype("float32"), d["game_id"]
    T = seq.shape[1]
    obs = max(2, int(T * float(mv.obs_frac)))
    horizon = T - obs
    m_tr, m_va, m_te = game_split(game_id, cfg.seed)
    print(f"sequences {seq.shape} | obs {obs} -> predict {horizon} | "
          f"games tr/va/te "
          f"{len(np.unique(game_id[m_tr]))}/{len(np.unique(game_id[m_va]))}/"
          f"{len(np.unique(game_id[m_te]))}")

    prefix = seq[:, :obs]
    target = seq[:, obs:, :2]
    true = target[m_te]
    cents = _centroids(seq, m_tr, int(mv.n_clusters), cfg.seed)

    preds, trained = {}, {}

    # ---- baselines ----
    preds["constant_velocity"] = constant_velocity(seq[m_te], obs, horizon)
    preds["centroid_replay"] = centroid_replay(seq[m_te], obs, cents)

    # every deep model trains under the SAME regimen (train_seq: warmup+cosine+clip)
    # so the comparison is fair — no architecture is handicapped by its trainer.
    EP = max(80, int(mv.gru_epochs))

    # ---- GRU (existing architecture) ----
    gru = TrajectoryGRU(seq.shape[2], int(mv.gru_hidden), horizon)
    gru, _ = train_seq(gru, prefix[m_tr], target[m_tr], prefix[m_va], target[m_va],
                       epochs=EP, seed=cfg.seed, teacher_forcing=True)
    preds["gru"] = predict_seq(gru, prefix[m_te])
    trained["gru"] = gru

    # ---- LSTM ----
    lstm = TrajectoryLSTM(seq.shape[2], int(mv.gru_hidden), horizon)
    lstm, _ = train_seq(lstm, prefix[m_tr], target[m_tr], prefix[m_va], target[m_va],
                        epochs=EP, seed=cfg.seed, teacher_forcing=True)
    preds["lstm"] = predict_seq(lstm, prefix[m_te])
    trained["lstm"] = lstm

    # ---- Transformer (encoder + learned-query cross-attention decoder) ----
    trm = TrajectoryTransformer(seq.shape[2], d_model=96, nhead=4, layers=3,
                                horizon=horizon)
    trm, _ = train_seq(trm, prefix[m_tr], target[m_tr], prefix[m_va], target[m_va],
                       epochs=EP, seed=cfg.seed, teacher_forcing=False)
    preds["transformer"] = predict_seq(trm, prefix[m_te])
    trained["transformer"] = trm

    # ---- evaluation ----
    results = {n: {"ade_ft": round(ade(p, true), 3), "fde_ft": round(fde(p, true), 3)}
               for n, p in preds.items()}
    print("\nTrajectory models (held-out games, lower = better):")
    print(f"  {'model':<18} {'ADE ft':>8} {'FDE ft':>8}")
    for n, r in sorted(results.items(), key=lambda kv: kv[1]["ade_ft"]):
        print(f"  {n:<18} {r['ade_ft']:>8.2f} {r['fde_ft']:>8.2f}")

    # best deep model by ADE
    deep = {n: results[n]["ade_ft"] for n in ("gru", "lstm", "transformer")}
    best = min(deep, key=deep.get)
    print(f"\n  best sequence model: {best} (ADE {deep[best]:.2f} ft)")

    # ---- move-type classifier (unchanged approach, reported for completeness) ----
    def assign(s):
        flat = s[:, :, :2].reshape(len(s), -1)
        cf = cents[:, :, :2].reshape(len(cents), -1)
        return ((flat[:, None] - cf[None]) ** 2).sum(-1).argmin(1)
    y_all = assign(seq)
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation
    X = prefix_features(seq, obs)
    clf = LGBMClassifier(n_estimators=1500, learning_rate=0.03, num_leaves=63,
                         min_child_samples=20, feature_fraction=0.9,
                         random_state=cfg.seed, verbose=-1)
    clf.fit(X[m_tr], y_all[m_tr], eval_set=[(X[m_va], y_all[m_va])],
            callbacks=[early_stopping(80), log_evaluation(0)])
    acc = move_type_accuracy(clf.predict(X[m_te]), y_all[m_te])
    maj = majority_baseline_accuracy(y_all[m_te])
    print(f"  move-type accuracy {acc:.3f} vs majority {maj:.3f}")

    # ---- persist: the winning sequence model (tagged), + comparison ----
    model = trained[best]
    bundle = {"arch": best, "state_dict": model.state_dict(),
              "in_dim": seq.shape[2], "hidden": int(mv.gru_hidden),
              "horizon": horizon, "obs": obs}
    if best == "transformer":
        bundle.update({"d_model": 96, "nhead": 4, "layers": 3})
    torch.save(bundle, out / "best_seq.pt")
    # keep gru.pt too (serving default / backwards-compat)
    torch.save({"state_dict": trained["gru"].state_dict(), "in_dim": seq.shape[2],
                "hidden": int(mv.gru_hidden), "horizon": horizon, "obs": obs},
               out / "gru.pt")

    comparison = {"n_sequences": int(len(seq)),
                  "n_games": int(len(np.unique(game_id))),
                  "obs": obs, "horizon": horizon,
                  "trajectory": results, "best_sequence_model": best,
                  "move_type_accuracy": round(acc, 4),
                  "majority_baseline": round(maj, 4)}
    (out / "comparison.json").write_text(json.dumps(comparison, indent=2))
    print(f"\n  wrote models/movement/comparison.json + best_seq.pt ({best})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
