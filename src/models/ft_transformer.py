"""FT-Transformer (Gorishniy et al., 2021) — the strongest tabular transformer.

Tokenises every continuous and categorical feature, prepends a [CLS] token, runs
transformer blocks, and reads the class from [CLS]. GPU. Included so the thesis
model comparison contains a genuine state-of-the-art deep-learning entry, not just
an MLP. (Prior evidence: on this data gradient boosting wins — see the leaderboard
and Grinsztajn et al., 2022.)

Implementation: `rtdl_revisiting_models.FTTransformer`.
"""
from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.metrics import roc_auc_score

from src.config import get_config
from src.models.deep_prep import DeepPrep


def _device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


@torch.no_grad()
def _predict(model, Xc, Xk, dev, bs: int = 2048) -> np.ndarray:
    """Batched inference — attention over ~80 tokens is memory-heavy, so a 6 GB
    card cannot take the whole split in one forward pass."""
    model.eval()
    outs = []
    for i in range(0, len(Xc), bs):
        xc = torch.from_numpy(Xc[i:i + bs]).to(dev)
        xk = torch.from_numpy(Xk[i:i + bs]).to(dev)
        outs.append(torch.sigmoid(model(xc, xk).squeeze(-1)).cpu().numpy())
    return np.concatenate(outs)


def fit_ft(ds, cfg=None) -> dict:
    cfg = cfg or get_config()
    dev = _device()
    torch.manual_seed(cfg.seed)
    from rtdl_revisiting_models import FTTransformer

    prep = DeepPrep(ds.meta).fit(ds.train)
    Xtr_c, Xtr_k = prep.transform(ds.train)
    Xva_c, Xva_k = prep.transform(ds.val)
    ytr = ds.train["MADE"].to_numpy().astype("float32")
    yva = ds.val["MADE"].to_numpy().astype("float32")

    # d_block 128 (not the paper's 192) keeps attention within a 6 GB card
    model = FTTransformer(
        n_cont_features=Xtr_c.shape[1],
        cat_cardinalities=prep.cardinalities,
        d_out=1,
        n_blocks=3, d_block=128, attention_n_heads=8,
        attention_dropout=0.2, ffn_d_hidden_multiplier=4 / 3,
        ffn_dropout=0.1, residual_dropout=0.0,
    ).to(dev)

    dl = DataLoader(
        TensorDataset(torch.from_numpy(Xtr_c), torch.from_numpy(Xtr_k),
                      torch.from_numpy(ytr)),
        batch_size=512, shuffle=True, drop_last=True)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-4, weight_decay=1e-5)
    loss_fn = nn.BCEWithLogitsLoss()

    print(f"  FT-Transformer on {dev.upper()} | {len(ds.train):,} rows | "
          f"{Xtr_c.shape[1]} cont + {len(prep.cardinalities)} cat")

    best, best_state, bad = 0.0, None, 0
    for ep in range(30):
        model.train()
        for xc, xk, yb in dl:
            xc, xk, yb = xc.to(dev), xk.to(dev), yb.to(dev)
            opt.zero_grad()
            out = model(xc, xk).squeeze(-1)
            loss_fn(out, yb).backward()
            opt.step()
        pv = _predict(model, Xva_c, Xva_k, dev)
        auc = roc_auc_score(yva, pv)
        if auc > best + 1e-4:
            best, bad = auc, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
        if (ep + 1) % 5 == 0:
            print(f"    epoch {ep + 1:>2}  val AUC {auc:.4f}  (best {best:.4f})")
        if bad >= 5:
            print(f"    early stop at epoch {ep + 1}")
            break
    if best_state:
        model.load_state_dict(best_state)
    model.to(dev).eval()
    return {"name": "fttransformer", "kind": "ft", "model": model, "prep": prep}


def predict_proba_ft(bundle: dict, X) -> np.ndarray:
    dev = _device()
    Xc, Xk = bundle["prep"].transform(X)
    return _predict(bundle["model"].to(dev), Xc, Xk, dev)
