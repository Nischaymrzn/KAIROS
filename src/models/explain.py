"""SHAP explainability for the production tree model. Provides global plots and
`explain_one`, which returns ranked signed contributions for a single shot."""
from __future__ import annotations
import json
import re

import joblib
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from src.config import get_config
from src.dataset import load_processed

TREE_MODELS = {"xgboost", "lightgbm", "catboost", "rf"}


def _best_tree_bundle(cfg):
    board = json.loads((cfg.path("models") / "leaderboard.json").read_text())
    for r in board["models"]:
        if r["name"] in TREE_MODELS:
            return joblib.load(cfg.path("models") / f"{r['name']}.joblib")
    raise RuntimeError("no tree model available for SHAP")


def _pretty(name: str) -> str:
    name = re.sub(r"^(num|cat)__", "", name)
    name = name.replace("_", " ")
    return name


class Explainer:
    def __init__(self, cfg=None):
        import shap
        self.cfg = cfg or get_config()
        self.bundle = _best_tree_bundle(self.cfg)
        self.pre = self.bundle["preprocessor"]
        self.names = [_pretty(n) for n in self.pre.get_feature_names_out()]
        self.explainer = shap.TreeExplainer(self.bundle["model"])

    def _sv(self, X: pd.DataFrame) -> np.ndarray:
        Xt = self.pre.transform(X).astype("float32")
        sv = self.explainer.shap_values(Xt)
        if isinstance(sv, list):           # some explainers return [neg, pos]
            sv = sv[1]
        return np.asarray(sv)

    def explain_one(self, X_row: pd.DataFrame, k: int = 6) -> list[dict]:
        sv = self._sv(X_row)[0]
        order = np.argsort(-np.abs(sv))[:k]
        return [{"feature": self.names[i], "contribution": float(sv[i])}
                for i in order]


def global_shap(n: int = 3000) -> None:
    """Save beeswarm + bar + dependence plots on a validation sample."""
    import shap
    cfg = get_config()
    ds = load_processed(cfg, with_test=False)
    ex = Explainer(cfg)
    samp = ds.val.sample(n=min(n, len(ds.val)), random_state=cfg.seed)
    Xt = ex.pre.transform(samp[ds.features]).astype("float32")
    sv = ex.explainer.shap_values(Xt)
    if isinstance(sv, list):
        sv = sv[1]
    out = cfg.path("figures") / "shap"
    out.mkdir(parents=True, exist_ok=True)

    shap.summary_plot(sv, features=Xt, feature_names=ex.names, show=False, max_display=15)
    plt.tight_layout(); plt.savefig(out / "beeswarm.png", dpi=120); plt.close()
    shap.summary_plot(sv, features=Xt, feature_names=ex.names, plot_type="bar",
                      show=False, max_display=15)
    plt.tight_layout(); plt.savefig(out / "bar.png", dpi=120); plt.close()

    # the mean absolute contribution per feature, written out so the thesis figure
    # can be plotted from the values rather than traced off this rendering
    import json
    import numpy as np
    order = np.argsort(np.abs(sv).mean(axis=0))[::-1]
    ranked = [{"feature": ex.names[i],
               "mean_abs_shap": float(np.abs(sv[:, i]).mean())} for i in order]
    payload = {"n_sampled": int(len(samp)), "split": "validation",
               "n_features": len(ex.names), "ranked": ranked}
    (cfg.path("figures") / "shap_importance.json").write_text(
        json.dumps(payload, indent=2))
    print(f"  SHAP global plots -> {out}")
    print(f"  SHAP importances -> {cfg.path('figures') / 'shap_importance.json'}")


if __name__ == "__main__":
    global_shap()
