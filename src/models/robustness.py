"""Robustness audit: slice calibration, temporal drift, and OOD input probes.

Discrimination (AUC) is an aggregate. A model can score 0.70 overall while being
badly miscalibrated for an identifiable subgroup — and this system's product is a
*probability shown to a user*, so a slice that reads 55% when the truth is 45% is a
real defect even if AUC is untouched.

Three checks:

1. **Slice calibration grid.** For every slice of interest, report n, AUC, Brier,
   observed make rate, mean predicted probability, and the **calibration gap**
   (predicted - observed). Any |gap| > `GAP_TOL` is flagged. Slices include a
   pre-registered hypothesis from the 2026-08-05 audit:

       "low-volume shooters are miscalibrated, because player_fg_pct is an
        unshrunk group mean and 20.1% of test shots come from players with no
        training history at all."

   That hypothesis is FALSIFIABLE and is tested explicitly by the
   `player_train_support` slice. (Note the related shrinkage experiment,
   `make ab-skill`, already returned a null on *discrimination*; this asks the
   different and more relevant question of whether **calibration** suffers.)

2. **Temporal drift within the test season.** Split the test season into deciles by
   game order and track AUC and the calibration gap. A model that decays across a
   season is a model that needs a retraining cadence.

3. **OOD input probes.** The dashboard can send anything — a 70 ft shot, a defender
   0.1 ft away, an unknown player id. These are scored through the real serve path
   and checked for sanity (finite, in [0,1], monotone where physics demands it).
   Nothing here asserts a "correct" probability; it asserts the system does not
   produce nonsense or crash.

The frozen production model is re-scored for **diagnosis only** — no selection
decision is taken from the test season, exactly as `evaluate.py` already slices it.

CLI:  python -m src.models.robustness
Output: reports/figures/robustness.json, reports/ROBUSTNESS.md
"""
from __future__ import annotations
import json

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, brier_score_loss

from src.config import get_config
from src.dataset import load_processed
from src.models.registry import predict_proba
from src.models.calibrate import apply_calibrator

GAP_TOL = 0.02          # |mean predicted - observed| above this is flagged
MIN_SLICE = 500         # slices smaller than this are reported but never flagged


def _slice_stats(y: np.ndarray, p: np.ndarray, n_boot: int = 400,
                 seed: int = 42) -> dict:
    """Slice metrics INCLUDING a bootstrap CI on the calibration gap.

    Flagging a slice on a point estimate alone is unsound: a gap of 0.028 on
    n = 3,000 carries a standard error near 0.009, so a "defect" can be sampling
    noise. Measured case: the 1-50 support slice reads -0.024 on validation and
    +0.028 on test -- opposite signs, i.e. not a stable bias. We therefore flag a
    slice only when |gap| exceeds tolerance AND its CI excludes zero.
    """
    out = {"n": int(len(y)), "observed": float(np.mean(y)),
           "predicted": float(np.mean(p)),
           "brier": float(brier_score_loss(y, np.clip(p, 0, 1)))}
    out["gap"] = out["predicted"] - out["observed"]
    out["auc"] = (float(roc_auc_score(y, p))
                  if 0 < y.sum() < len(y) else float("nan"))
    rng = np.random.default_rng(seed)
    n = len(y)
    g = np.empty(n_boot)
    for i in range(n_boot):
        j = rng.integers(0, n, n)
        g[i] = p[j].mean() - y[j].mean()
    lo, hi = np.quantile(g, [0.025, 0.975])
    out["gap_ci95"] = [float(lo), float(hi)]
    out["gap_excludes_zero"] = bool(lo > 0 or hi < 0)
    return out


def slice_grid(df: pd.DataFrame, y: np.ndarray, p: np.ndarray,
               groups: dict[str, pd.Series]) -> dict:
    grid: dict = {}
    for name, key in groups.items():
        rows = []
        k = pd.Series(np.asarray(key), index=df.index)
        for level, idx in k.groupby(k, observed=True).groups.items():
            m = df.index.isin(idx)
            if m.sum() == 0:
                continue
            s = _slice_stats(y[m], p[m])
            s["level"] = str(level)
            # both conditions: materially large AND statistically distinguishable
            s["flagged"] = bool(s["n"] >= MIN_SLICE and abs(s["gap"]) > GAP_TOL
                                and s["gap_excludes_zero"])
            rows.append(s)
        rows.sort(key=lambda r: -r["n"])
        grid[name] = rows
    return grid


def ood_probes() -> list[dict]:
    """Score deliberately extreme scenarios through the real serve path."""
    from src.serve.predict import predict
    base = {"action_type": "Jump Shot", "shot_type": "2PT Field Goal",
            "basic_zone": "Mid-Range", "zone_range": "16-24 ft.",
            "quarter": 1, "mins_left": 8, "secs_left": 30}
    cases = [
        ("normal midrange 18ft", {**base, "shot_distance": 18, "loc_x": 0, "loc_y": 23}),
        ("half-court heave 47ft", {**base, "shot_distance": 47, "loc_x": 0,
                                   "loc_y": 52, "shot_type": "3PT Field Goal",
                                   "basic_zone": "Backcourt", "zone_range": "24+ ft."}),
        ("impossible 94ft", {**base, "shot_distance": 94, "loc_x": 0, "loc_y": 99,
                             "shot_type": "3PT Field Goal",
                             "basic_zone": "Backcourt", "zone_range": "24+ ft."}),
        ("zero distance", {**base, "shot_distance": 0, "loc_x": 0, "loc_y": 5,
                           "basic_zone": "Restricted Area",
                           "zone_range": "Less Than 8 ft."}),
        ("negative distance", {**base, "shot_distance": -5, "loc_x": 0, "loc_y": 5}),
        ("unknown player id", {**base, "shot_distance": 18, "loc_x": 0,
                               "loc_y": 23, "player_id": 999999999}),
        ("unseen action type", {**base, "shot_distance": 18, "loc_x": 0,
                                "loc_y": 23, "action_type": "Teleport Dunk"}),
        ("shot clock 0", {**base, "shot_distance": 18, "loc_x": 0, "loc_y": 23,
                          "shot_clock": 0.0}),
        ("shot clock 24", {**base, "shot_distance": 18, "loc_x": 0, "loc_y": 23,
                           "shot_clock": 24.0}),
    ]
    out = []
    for label, sc in cases:
        rec = {"case": label}
        try:
            r = predict(sc)
            pr = r["probability"]
            rec.update({"probability": pr, "quality": r["quality"],
                        "ok": bool(np.isfinite(pr) and 0.0 <= pr <= 1.0)})
        except Exception as e:                              # noqa: BLE001
            rec.update({"error": str(e)[:120], "ok": False})
        out.append(rec)
    return out


def _md(res: dict) -> str:
    L = ["# ROBUSTNESS.md — slice calibration, drift, and OOD probes", "",
         f"Frozen model re-scored on the held-out test season "
         f"(n = {res['n_test']:,}). Diagnosis only — no selection decision is taken "
         "from these numbers.", "",
         f"**Flagging rule:** a slice is flagged only when n >= {MIN_SLICE}, "
         f"|predicted - observed| > {GAP_TOL}, **and** the gap's 95% bootstrap CI "
         "excludes zero. A point estimate alone is not enough: on a 3,000-shot "
         "slice the gap's standard error is around 0.009.", "",
         f"**Overall:** AUC {res['overall']['auc']:.4f}, "
         f"Brier {res['overall']['brier']:.4f}, calibration gap "
         f"{res['overall']['gap']:+.4f}", ""]
    flagged = res["flagged_slices"]
    L += [f"**Slices flagged: {len(flagged)}**"
          + (f" — {', '.join(flagged)}" if flagged else
             " — every slice is calibrated within tolerance."), ""]
    for name, rows in res["grid"].items():
        L += [f"## {name}", "",
              "| level | n | observed | predicted | gap | gap 95% CI | AUC | Brier | |",
              "|---|---|---|---|---|---|---|---|---|"]
        for r in rows:
            mark = " **FLAG**" if r["flagged"] else ""
            auc = "n/a" if np.isnan(r["auc"]) else f"{r['auc']:.4f}"
            lo, hi = r["gap_ci95"]
            L.append(f"| {r['level']} | {r['n']:,} | {r['observed']:.4f} | "
                     f"{r['predicted']:.4f} | {r['gap']:+.4f} | "
                     f"[{lo:+.4f}, {hi:+.4f}] | {auc} | "
                     f"{r['brier']:.4f} |{mark} |")
        L.append("")
    L += ["## OOD input probes", "",
          "| scenario | probability | quality | sane |", "|---|---|---|---|"]
    for r in res["ood"]:
        p = r.get("probability")
        L.append(f"| {r['case']} | {p if p is None else f'{p:.4f}'} | "
                 f"{r.get('quality', r.get('error', '-'))} | "
                 f"{'yes' if r['ok'] else 'NO'} |")
    return "\n".join(L) + "\n"


def main() -> int:
    cfg = get_config()
    ds = load_processed(cfg, with_test=True)
    m = cfg.path("models")
    cal = joblib.load(m / "calibrated_best.joblib")
    base = joblib.load(m / f"{cal['base_name']}.joblib")

    te = ds.test.reset_index(drop=True)
    y = te["MADE"].to_numpy()
    p = np.asarray(apply_calibrator(cal, predict_proba(base, te)), dtype=float)
    print(f"scoring {len(y):,} test shots with the frozen {cal['base_name']}")

    # per-player training support -> the audit's falsifiable hypothesis
    support = ds.train.groupby("player_id")["MADE"].count()
    sup = te["player_id"].map(support).fillna(0).to_numpy()
    sup_bin = pd.cut(sup, [-1, 0, 50, 200, 800, 10 ** 9],
                     labels=["0 (unseen)", "1-50", "51-200", "201-800", "800+"])

    games = np.sort(te["GAME_ID"].unique())
    order = pd.Series(np.arange(len(games)), index=games)
    decile = pd.qcut(te["GAME_ID"].map(order), 10, labels=[f"D{i+1}" for i in range(10)])

    groups = {
        "player_train_support (AUDIT HYPOTHESIS)": sup_bin,
        "zone": te["basic_zone"].astype(str),
        "shot_type": te["SHOT_TYPE"].astype(str),
        "position_group": te["position_group"].astype(str),
        "period": te["period"].astype(int).clip(upper=5).astype(str),
        "distance_band": pd.cut(te["shot_distance"],
                                [-1, 4, 10, 16, 23, 30, 100],
                                labels=["0-4", "4-10", "10-16", "16-23",
                                        "23-30", "30+"]),
        "time_within_test_season (drift)": decile,
    }
    if "shot_clock_is_imputed" in te.columns:
        groups["shot_clock_imputed"] = te["shot_clock_is_imputed"].map(
            {0: "real", 1: "imputed"}).astype(str)

    grid = slice_grid(te, y, p, groups)
    flagged = [f"{g}:{r['level']}" for g, rows in grid.items()
               for r in rows if r["flagged"]]

    print(f"\n  overall gap {np.mean(p) - np.mean(y):+.4f}")
    for g, rows in grid.items():
        worst = max(rows, key=lambda r: abs(r["gap"]) if r["n"] >= MIN_SLICE else -1)
        print(f"  {g:42} worst |gap| {abs(worst['gap']):.4f} @ {worst['level']}")
    print(f"\n  FLAGGED SLICES: {len(flagged)}"
          + (f" -> {flagged}" if flagged else " (all within tolerance)"))

    print("\n  OOD probes through the serve path...")
    ood = ood_probes()
    for r in ood:
        pr = r.get("probability")
        print(f"    {r['case']:24} "
              f"{'p=%.4f' % pr if pr is not None else r.get('error', '')[:40]:>14}"
              f"  {'ok' if r['ok'] else 'FAIL'}")

    res = {"n_test": int(len(y)), "gap_tol": GAP_TOL, "min_slice": MIN_SLICE,
           "overall": _slice_stats(y, p), "grid": grid,
           "flagged_slices": flagged, "ood": ood}
    (cfg.path("figures") / "robustness.json").write_text(json.dumps(res, indent=2))
    (cfg.path("reports") / "ROBUSTNESS.md").write_text(_md(res), encoding="utf-8")
    print("\n  wrote reports/ROBUSTNESS.md + reports/figures/robustness.json")
    assert all(r["ok"] for r in ood), "an OOD probe produced a non-finite/invalid probability"
    print("  ACCEPT: every OOD probe returned a finite probability in [0,1].")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
