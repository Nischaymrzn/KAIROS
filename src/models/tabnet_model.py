"""TabNet (Arik & Pfister, 2021) — attentive, sequential feature selection with
learnable sparse masks. GPU. A second modern deep-learning entry for the thesis
model comparison. Implementation: `pytorch_tabnet.tab_model.TabNetClassifier`.
"""
from __future__ import annotations

import numpy as np
import torch

from src.config import get_config
from src.models.deep_prep import DeepPrep


def fit_tabnet(ds, cfg=None) -> dict:
    cfg = cfg or get_config()
    from pytorch_tabnet.tab_model import TabNetClassifier

    prep = DeepPrep(ds.meta).fit(ds.train)
    n_cont = len(prep.num)
    cat_idxs = list(range(n_cont, n_cont + len(prep.cat)))
    cat_dims = prep.cardinalities
    cat_emb = [int(min(32, round(1.6 * c ** 0.56))) for c in cat_dims]

    def _mat(part):
        Xc, Xk = prep.transform(part)
        return np.hstack([Xc, Xk.astype("float32")]).astype("float32")

    Xtr, Xva = _mat(ds.train), _mat(ds.val)
    ytr = ds.train["MADE"].to_numpy().astype("int64")
    yva = ds.val["MADE"].to_numpy().astype("int64")

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"  TabNet on {dev.upper()} | {len(ds.train):,} rows | "
          f"{n_cont} cont + {len(cat_dims)} cat")
    clf = TabNetClassifier(
        cat_idxs=cat_idxs, cat_dims=cat_dims, cat_emb_dim=cat_emb,
        n_d=32, n_a=32, n_steps=4, gamma=1.4,
        optimizer_params=dict(lr=2e-2), device_name=dev, seed=cfg.seed, verbose=0)
    clf.fit(Xtr, ytr, eval_set=[(Xva, yva)], eval_metric=["auc"],
            max_epochs=60, patience=8, batch_size=8192, virtual_batch_size=1024)
    return {"name": "tabnet", "kind": "tabnet", "model": clf, "prep": prep,
            "n_cont": n_cont}


def predict_proba_tabnet(bundle: dict, X) -> np.ndarray:
    Xc, Xk = bundle["prep"].transform(X)
    mat = np.hstack([Xc, Xk.astype("float32")]).astype("float32")
    return bundle["model"].predict_proba(mat)[:, 1]
