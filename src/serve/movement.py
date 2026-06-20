"""Serve movement predictions: a plausible path INTO a requested shot.

Contract (SPEC → Movement & trajectory prediction):
    predict_move({loc_x, loc_y}) ->
        {move_type, confidence, method, waypoints: [{x, y, t, speed, heading}, ...]}

`loc_x/loc_y` use the shot-chart frame (hoop at origin, feet; x lateral,
y toward half court). Internally the movement models live in the SportVU
half-court frame (basket at (5.35, 25), x depth, y lateral); this module maps
between the two so the dashboard can render waypoints directly.

Serving strategy — the trained GRU actually runs:
  * The GRU is a *continuation* model: it consumes an observed prefix (obs frames
    × all waypoint features) and rolls out the next `horizon` positions.
  * If the caller supplies a real observed prefix, we roll the GRU straight from
    it  (`method="gru"`).
  * The dashboard has no prefix — only a target release spot. There we seed the
    prefix from the canonical move template (cluster medoid) whose release point
    is nearest the request, then let the **GRU predict the continuation**
    (`method="gru_seeded"`). The approach is a real recorded path; the second half
    is a genuine model prediction.
  * If the GRU bundle is missing we replay the medoid outright
    (`method="template"`), which is what the service used to do unconditionally.

The finished path is shifted so its last waypoint lands exactly on the requested
shot location, then lightly smoothed for animation.
"""
from __future__ import annotations
import math

import joblib
import numpy as np

from src.config import get_config

BASKET = (5.35, 25.0)
_STATE: dict | None = None


def _to_sportvu(loc_x: float, loc_y: float) -> tuple[float, float]:
    return BASKET[0] + loc_y, BASKET[1] + loc_x


def _to_chart(x: float, y: float) -> tuple[float, float]:
    return y - BASKET[1], x - BASKET[0]


def _load_gru(d):
    """Load the trained sequence model (whichever architecture won the comparison),
    or None if unavailable. Prefers `best_seq.pt` (tagged with `arch`), falls back
    to `gru.pt`. The serving contract is architecture-agnostic: predict_move only
    calls model(prefix)."""
    fp = d / "best_seq.pt" if (d / "best_seq.pt").exists() else d / "gru.pt"
    if not fp.exists():
        return None
    try:
        import torch
        bundle = torch.load(fp, map_location="cpu", weights_only=False)
        arch = bundle.get("arch", "gru")
        if arch == "lstm":
            from src.movement.seq_models import TrajectoryLSTM
            model = TrajectoryLSTM(bundle["in_dim"], bundle["hidden"], bundle["horizon"])
        elif arch == "transformer":
            from src.movement.seq_models import TrajectoryTransformer
            model = TrajectoryTransformer(
                bundle["in_dim"], bundle.get("d_model", 64), bundle.get("nhead", 4),
                bundle.get("layers", 2), bundle["horizon"])
        else:
            from src.movement.sequence_model import TrajectoryGRU
            model = TrajectoryGRU(bundle["in_dim"], bundle["hidden"], bundle["horizon"])
        model.load_state_dict(bundle["state_dict"])
        model.eval()
        return {"model": model, "arch": arch, "obs": int(bundle["obs"]),
                "horizon": int(bundle["horizon"]), "in_dim": int(bundle["in_dim"])}
    except Exception:  # torch missing / shape drift -> template fallback
        return None


def _load() -> dict:
    global _STATE
    if _STATE is None:
        cfg = get_config()
        d = cfg.path("models") / "movement"
        bundle = joblib.load(d / "move_types.joblib")
        # prefer medoids (real, physically plausible paths) over raw centroids
        cents = np.asarray(bundle.get("medoids", bundle["centroids"]), dtype="float32")
        share = bundle.get("cluster_share")
        if share is None:
            share = np.full(len(cents), 1.0 / len(cents), dtype="float32")
        _STATE = {"centroids": cents, "share": np.asarray(share, "float32"),
                  "gru": _load_gru(d)}
    return _STATE


def _roll_gru(gru: dict, prefix: np.ndarray) -> np.ndarray:
    """prefix (obs, F) -> predicted (horizon, 2) positions."""
    import torch
    with torch.no_grad():
        out = gru["model"](torch.from_numpy(prefix[None].astype("float32")))
    return out[0].numpy()


def _smooth(path: np.ndarray) -> np.ndarray:
    if len(path) > 4:
        inner = (path[:-2] + path[1:-1] + path[2:]) / 3.0
        path = np.vstack([path[:1], inner, path[-1:]])
    return path


def predict_move(scenario: dict, observed: list | None = None) -> dict:
    """Return the most plausible path ending at the requested spot.

    `observed`: optional real prefix, a list of rows with the waypoint feature
    layout (x, y, t, speed, heading, basket_dist, def_dist, has_ball) in the
    SportVU frame. When supplied the GRU rolls out directly from it.
    """
    st = _load()
    cents = st["centroids"]
    gru = st["gru"]
    tx, ty = _to_sportvu(float(scenario.get("loc_x", 0.0)),
                         float(scenario.get("loc_y", 12.0)))

    # nearest template by release-point (last waypoint) distance
    rel = cents[:, -1, :2]
    d = np.hypot(rel[:, 0] - tx, rel[:, 1] - ty)
    k = int(d.argmin())
    conf = float(st["share"][k] * math.exp(-d[k] / 10.0))

    method = "template"
    path = cents[k, :, :2].copy()

    if gru is not None:
        obs, in_dim = gru["obs"], gru["in_dim"]
        # Report the architecture actually loaded. best_seq.pt is whichever model
        # won the last bake-off, so hardcoding "gru" would have the API claim a
        # GRU while serving a transformer.
        arch = gru.get("arch", "gru")
        if observed is not None and len(observed) >= obs:
            prefix = np.asarray(observed, dtype="float32")[-obs:, :in_dim]
            method = arch
        elif cents.shape[1] >= obs and cents.shape[2] >= in_dim:
            prefix = cents[k, :obs, :in_dim].astype("float32")
            method = f"{arch}_seeded"
        else:
            prefix = None
        if prefix is not None:
            future = _roll_gru(gru, prefix)          # (horizon, 2)
            path = np.vstack([prefix[:, :2], future])

    # shift so the path ends exactly at the requested release spot, then smooth
    path = path.astype("float32")
    path += np.array([tx, ty], "float32") - path[-1]
    path = _smooth(path)

    waypoints = []
    t_step = 4.0 / max(len(path) - 1, 1)  # window_sec spread over the path
    for i, (x, y) in enumerate(path):
        cx, cy = _to_chart(float(x), float(y))
        if i == 0:
            speed, heading = 0.0, 0.0
        else:
            dx = float(path[i][0] - path[i - 1][0])
            dy = float(path[i][1] - path[i - 1][1])
            speed = math.hypot(dx, dy) / t_step
            heading = math.atan2(dy, dx)
        waypoints.append({"x": round(cx, 2), "y": round(cy, 2),
                          "t": round(i * t_step, 2),
                          "speed": round(speed, 2), "heading": round(heading, 3)})
    return {"move_type": f"template_{k}", "confidence": round(min(conf, 1.0), 3),
            "method": method, "waypoints": waypoints}


if __name__ == "__main__":
    r = predict_move({"loc_x": 10, "loc_y": 14})
    print(r["move_type"], r["confidence"], "method:", r["method"],
          "steps:", len(r["waypoints"]))
    print("release:", r["waypoints"][-1])


# --------------------------------------------------------- per-player retrieval

_PLAYER_STATE = None


def _load_player_moves():
    """Per-player medoid approaches from the 2015-16 corpus, if built."""
    global _PLAYER_STATE
    if _PLAYER_STATE is None:
        fp = get_config().path("models") / "movement" / "player_moves.npz"
        if not fp.exists():
            _PLAYER_STATE = {}
        else:
            z = np.load(fp, allow_pickle=False)
            _PLAYER_STATE = {
                "index": {int(p): i for i, p in enumerate(z["player_id"])},
                "paths": z["paths"], "valid": z["valid"], "release": z["release"],
                "speed": z["speed"], "n_seq": z["n_seq"], "stats": z["stats"],
                "stat_names": [str(s) for s in z["stat_names"]],
                "pressure_names": [str(s) for s in z["pressure_names"]],
                "edges": z["pressure_edges"],
            }
    return _PLAYER_STATE


def _pressure_bin(state, defender_ft) -> int:
    if defender_ft is None:
        return 2  # "open" — the modal band, and what an unspecified contest means
    d = float(defender_ft)
    for i, (lo, hi) in enumerate(state["edges"]):
        if lo <= d < hi:
            return int(i)
    return len(state["edges"]) - 1


def predict_move_player(scenario: dict, player_id: int, defender_ft=None) -> dict | None:
    """This player's own tracked approach to this spot under this pressure.

    Returns None when the player has no signature, so the caller can fall back to
    the league model. Nothing here is generated: the path is a real sequence that
    player ran, retrieved by release point and contest, then translated onto the
    requested spot the same way the league templates are.
    """
    st = _load_player_moves()
    if not st or int(player_id) not in st["index"]:
        return None

    pi = st["index"][int(player_id)]
    tx, ty = _to_sportvu(float(scenario.get("loc_x", 0.0)),
                         float(scenario.get("loc_y", 12.0)))

    # requested pressure first; widen outwards only if that band is empty
    want = _pressure_bin(st, defender_ft)
    order = sorted(range(len(st["edges"])), key=lambda b: abs(b - want))

    for bi in order:
        slots = np.flatnonzero(st["valid"][pi, bi])
        if not len(slots):
            continue
        rel = st["release"][pi, bi][slots]
        d = np.hypot(rel[:, 0] - tx, rel[:, 1] - ty)
        k = int(slots[int(d.argmin())])
        path = st["paths"][pi, bi, k].astype("float32").copy()
        spd = st["speed"][pi, bi, k]

        path += np.array([tx, ty], "float32") - path[-1]
        path = _smooth(path)

        t_step = 4.0 / max(len(path) - 1, 1)
        waypoints = []
        for i, (x, y) in enumerate(path):
            cx, cy = _to_chart(float(x), float(y))
            heading = 0.0 if i == 0 else math.atan2(
                float(path[i][1] - path[i - 1][1]), float(path[i][0] - path[i - 1][0]))
            waypoints.append({"x": round(cx, 2), "y": round(cy, 2),
                              "t": round(i * t_step, 2),
                              "speed": round(float(spd[i]), 2),
                              "heading": round(heading, 3)})

        return {
            "move_type": f"{st['pressure_names'][bi]}_{k}",
            "confidence": round(float(min(1.0, 1.0 / (1.0 + d.min() / 8.0))), 3),
            "method": "player_tracked",
            "player_id": int(player_id),
            "n_sequences": int(st["n_seq"][pi]),
            "pressure": st["pressure_names"][bi],
            "pressure_requested": st["pressure_names"][want],
            "release_gap_ft": round(float(d.min()), 1),
            "stats": {n: round(float(v), 3)
                      for n, v in zip(st["stat_names"], st["stats"][pi])},
            "waypoints": waypoints,
        }
    return None


def player_move_index() -> dict:
    """Which players have a tracked movement signature, and how strong it is."""
    st = _load_player_moves()
    if not st:
        return {"players": [], "available": False}
    return {
        "available": True,
        "players": [
            {"player_id": pid, "n_sequences": int(st["n_seq"][i]),
             "stats": {n: round(float(v), 3)
                       for n, v in zip(st["stat_names"], st["stats"][i])}}
            for pid, i in sorted(st["index"].items(), key=lambda kv: -st["n_seq"][kv[1]])
        ],
        "pressure_names": st["pressure_names"],
        "source": "2015-16 SportVU",
    }
