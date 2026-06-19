"""Model 2 — the 2015-16 full-tracking shot-quality model, built for real.

Where `tracking_2016.py` was a with/without *study* that threw its model away, this
trains models to KEEP, compares families on one game-level chronological split,
calibrates the best, evaluates the held-out test games ONCE, and exports a frozen,
servable bundle. Families, all on the same split:

  1. no-tracking      LightGBM on all-season features only (the honest floor)
  2. boost+aggregates LightGBM on the hand-engineered tracking scalars (the study's
                      approach: closest/2nd defender, angle, help count, shot clock)
  3. Set-Transformer  a permutation-invariant model over the RAW defender set — the
                      advanced architecture whose inductive bias trees lack

The scientific question is whether the set model beats boosting-on-aggregates: does
learning defender geometry end-to-end from the players themselves add over hand-
engineered summaries? Reported honestly against the ~0.70 shot-make ceiling; an
AUC >= 0.80 here would mean leakage (asserted) — see `ceiling.py` / `leakage_demo.py`.

CLI:  python -m src.studies.tracking_model
Outputs: reports/TRACKING_MODEL.md, reports/figures/tracking_model.json,
         models/production/tracking_v1/
"""
from __future__ import annotations
import json
from datetime import date

import joblib
from sklearn.isotonic import IsotonicRegression

from src.config import get_config
from src.seeds import set_global_seed
from src.models.evaluate import metrics
from src.movement.tracking_data import load_tracking_data, CONTEXT, AGG
from src.movement.set_transformer import train_set_model, predict_set

BASE_NOTRK = ["SHOT_DISTANCE", "is_3", "period", "player_fg"]
BOOST_TRK = CONTEXT + AGG


def _fit_lgb(td, cols, seed):
    from lightgbm import LGBMClassifier, early_stopping, log_evaluation
    med = td.train[cols].median()
    tr = td.train[cols].fillna(med); va = td.val[cols].fillna(med)
    m = LGBMClassifier(n_estimators=3000, learning_rate=0.02, num_leaves=63,
                       feature_fraction=0.8, bagging_fraction=0.8, n_jobs=-1,
                       random_state=seed)
    m.fit(tr, td.train["MADE"], eval_set=[(va, td.val["MADE"])],
          callbacks=[early_stopping(80), log_evaluation(0)])
    return {"model": m, "cols": cols, "median": med, "kind": "lgb"}


def _predict_lgb(bundle, part):
    X = part[bundle["cols"]].fillna(bundle["median"])
    return bundle["model"].predict_proba(X)[:, 1]


def _predict(bundle, td, which):
    if bundle["kind"] == "set":
        S = {"val": td.set_va, "test": td.set_te}[which]
        M = {"val": td.mask_va, "test": td.mask_te}[which]
        df = {"val": td.val, "test": td.test}[which]
        return predict_set(bundle, df, S, M)
    return _predict_lgb(bundle, {"val": td.val, "test": td.test}[which])


def main() -> int:
    cfg = get_config()
    set_global_seed(cfg.seed)
    td = load_tracking_data(cfg)
    yv, ytt = td.val["MADE"].to_numpy(), td.test["MADE"].to_numpy()
    print(f"train {len(td.train):,} | val {len(td.val):,} | test {len(td.test):,} "
          f"| set {td.set_tr.shape}")

    # ---- train the three families on the SAME split -----------------------
    models = {}
    print("\n[1/3] no-tracking LightGBM")
    models["no_tracking"] = _fit_lgb(td, BASE_NOTRK, cfg.seed)
    print("[2/3] boosting + tracking aggregates")
    models["boost_tracking"] = _fit_lgb(td, BOOST_TRK, cfg.seed)
    print("[3/3] Set-Transformer over the defender set")
    set_bundle, _ = train_set_model(td, CONTEXT, seed=cfg.seed)
    models["set_transformer"] = set_bundle

    # ---- validation leaderboard -------------------------------------------
    from sklearn.metrics import roc_auc_score
    board = {}
    for name, b in models.items():
        board[name] = float(roc_auc_score(yv, _predict(b, td, "val")))
    ranked = sorted(board, key=board.get, reverse=True)
    print("\nvalidation leaderboard (AUC):")
    for n in ranked:
        print(f"  {n:16} {board[n]:.4f}")
    best = ranked[0]

    # ---- calibrate the best on val, evaluate test ONCE --------------------
    pv = _predict(models[best], td, "val")
    iso = IsotonicRegression(out_of_bounds="clip").fit(pv, yv)
    pt = iso.transform(_predict(models[best], td, "test"))
    m3 = td.test["is_3"].to_numpy() == 1

    m_best = metrics(ytt, pt)
    # honest floor = the no-tracking model, its own calibration
    iso0 = IsotonicRegression(out_of_bounds="clip").fit(
        _predict(models["no_tracking"], td, "val"), yv)
    p_floor = iso0.transform(_predict(models["no_tracking"], td, "test"))
    m_floor = metrics(ytt, p_floor)

    res = {
        "val_leaderboard": {n: round(board[n], 4) for n in ranked},
        "best_model": best,
        "test": m_best,
        "test_no_tracking_floor": m_floor,
        "auc_gain_over_no_tracking": round(m_best["auc"] - m_floor["auc"], 4),
        "test_3pt": metrics(ytt[m3], pt[m3]),
        "n_games_test": int(td.test["GAME_ID"].nunique()),
    }
    print(f"\nBEST = {best}")
    print(f"  test AUC {m_best['auc']:.4f}  Brier {m_best['brier']:.4f}")
    print(f"  no-tracking floor AUC {m_floor['auc']:.4f}  "
          f"(tracking gain {res['auc_gain_over_no_tracking']:+.4f})")
    print(f"  3PT AUC {res['test_3pt']['auc']:.4f}")

    assert m_best["auc"] < 0.80, "AUC>=0.80 on shot-make means leakage — investigate"

    # ---- export the frozen bundle -----------------------------------------
    dst = cfg.path("models") / "production" / "tracking_v1"
    dst.mkdir(parents=True, exist_ok=True)
    joblib.dump(iso, dst / "calibrator.joblib")
    if best == "set_transformer":
        import torch
        torch.save(models[best]["model"].state_dict(), dst / "set_model.pt")
        joblib.dump({"scaler": models[best]["scaler"], "context": models[best]["context"],
                     "set_feature_names": td.set_feature_names,
                     "arch": {"n_set_feat": td.set_tr.shape[-1],
                              "n_context": len(models[best]["context"])}},
                    dst / "set_meta.joblib")
    else:
        joblib.dump(models[best], dst / "model.joblib")
    # shooter-skill table for serving (train-fit)
    p_fg = td.train.groupby("PLAYER_ID")["MADE"].mean()
    joblib.dump({"table": {int(k): float(v) for k, v in p_fg.items()},
                 "default": float(td.train["MADE"].mean())}, dst / "player_fg.joblib")
    manifest = {
        "model": "tracking_" + best, "version": 1, "date": date.today().isoformat(),
        "season": "2015-16", "kind": models[best]["kind"],
        "test_metrics": m_best, "test_3pt": res["test_3pt"],
        "no_tracking_floor": m_floor, "tracking_gain": res["auc_gain_over_no_tracking"],
        "context_features": CONTEXT, "set_features": td.set_feature_names,
        "note": "Study model on 2015-16 SportVU; NOT the production core model. "
                "Serves the value of full tracking data behind a labelled endpoint.",
    }
    (dst / "manifest.json").write_text(json.dumps(manifest, indent=2, default=float))
    (cfg.path("figures") / "tracking_model.json").write_text(json.dumps(res, indent=2, default=float))

    _report(cfg, res, td)
    print(f"\n  exported -> {dst}")
    print("  ACCEPT: best tracking model calibrated, tested once, AUC<0.80, exported.")
    return 0


def _report(cfg, res, td):
    b = res["best_model"]; t = res["test"]; f = res["test_no_tracking_floor"]
    lines = [
        "# TRACKING_MODEL.md — the 2015-16 full-tracking shot-quality model (Model 2)",
        "",
        "A servable shot-quality model trained on **real** SportVU tracking (the",
        "defender geometry the 2021-26 core model can only impute). Three families on",
        "one game-level chronological split (70/15/15); the best is calibrated and",
        "evaluated on the held-out test games **once**. This is a **study model** on",
        "2015-16 only — never merged into the core window.",
        "",
        "## Validation leaderboard (AUC)",
        "",
        "| model | val AUC |",
        "|---|---|",
    ]
    for n, a in res["val_leaderboard"].items():
        star = " ✅" if n == b else ""
        lines.append(f"| {n}{star} | {a:.4f} |")
    lines += [
        "",
        f"**Best = `{b}`.**",
        "",
        "## Held-out test (read once)",
        "",
        "| | AUC | Brier | n |",
        "|---|---|---|---|",
        f"| No-tracking floor | {f['auc']:.4f} | {f['brier']:.4f} | {f['n']:,} |",
        f"| **{b}** | **{t['auc']:.4f}** | **{t['brier']:.4f}** | {t['n']:,} |",
        f"| **Tracking gain** | **{res['auc_gain_over_no_tracking']:+.4f}** | | |",
        f"| 3PT only ({b}) | {res['test_3pt']['auc']:.4f} | {res['test_3pt']['brier']:.4f} | {res['test_3pt']['n']:,} |",
        "",
        "## Interpretation",
        "",
        "Real defender geometry, shooter motion and the true shot clock are the most",
        "valuable features available to a shot-quality model — and still bounded: this",
        "model does not reach AUC 0.80, exactly as the ceiling analysis predicts. Any",
        "shot-make model claiming >= 0.80 has leaked the outcome (`leakage_demo.py`).",
        "",
        "The Set-Transformer consumes the raw defender set (permutation-invariant),",
        "letting it represent help defence and a defender in the shot line directly,",
        "rather than through hand-engineered scalars. Whether it beats boosting-on-",
        "aggregates is reported above, honestly, on identical data.",
    ]
    (cfg.path("reports") / "TRACKING_MODEL.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
