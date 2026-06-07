"""TabularMLP (PyTorch, CPU). Embeddings for high-cardinality categoricals
(player_id, action_type), concatenated with standardised numerics + one-hot of
low-card categoricals. Trains on a subsample so CPU epochs stay short; evaluates
on the full validation set."""
from __future__ import annotations

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.metrics import roc_auc_score

from src.config import get_config

EMB_COLS = ["player_id", "action_type"]


def _emb_dim(card: int) -> int:
    return int(min(50, round(1.6 * card ** 0.56)))


def _lowcard(meta: dict) -> list[str]:
    return [c for c in meta["categorical"] if c != "action_type"]


def _make_num_pre(meta: dict) -> ColumnTransformer:
    try:
        ohe = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        ohe = OneHotEncoder(handle_unknown="ignore", sparse=False)
    return ColumnTransformer(
        [("num", StandardScaler(), meta["numeric"]),
         ("cat", ohe, _lowcard(meta))], sparse_threshold=0)


def _fit_cat_maps(train: pd.DataFrame):
    maps, cards = {}, []
    for c in EMB_COLS:
        vals = train[c].astype(str).unique().tolist()
        m = {v: i + 1 for i, v in enumerate(vals)}  # 0 = unknown
        maps[c] = m
        cards.append(len(m) + 1)
    return maps, cards


def _encode_cat(df: pd.DataFrame, maps: dict) -> np.ndarray:
    cols = [df[c].astype(str).map(maps[c]).fillna(0).astype("int64").values
            for c in EMB_COLS]
    return np.stack(cols, axis=1)


class TabularMLP(nn.Module):
    def __init__(self, cat_cardinalities, n_numeric, hidden=(256, 128), p=(0.3, 0.2)):
        super().__init__()
        self.embs = nn.ModuleList(
            [nn.Embedding(c, _emb_dim(c)) for c in cat_cardinalities])
        emb_out = sum(e.embedding_dim for e in self.embs)
        layers, d = [], emb_out + n_numeric
        for h, drop in zip(hidden, p):
            layers += [nn.Linear(d, h), nn.BatchNorm1d(h), nn.ReLU(), nn.Dropout(drop)]
            d = h
        layers += [nn.Linear(d, 1)]
        self.net = nn.Sequential(*layers)

    def forward(self, x_cat, x_num):
        e = [emb(x_cat[:, i]) for i, emb in enumerate(self.embs)]
        return self.net(torch.cat(e + [x_num], dim=1)).squeeze(1)


def fit_deep(ds, cfg=None) -> dict:
    cfg = cfg or get_config()
    torch.manual_seed(cfg.seed)
    dp = cfg.deep

    # subsample train for short CPU epochs; evaluate on full val
    tr = ds.train
    n = int(dp.train_sample)
    if n and n < len(tr):
        tr = tr.sample(n=n, random_state=cfg.seed)

    num_pre = _make_num_pre(ds.meta)
    Xnum_tr = num_pre.fit_transform(tr).astype("float32")
    Xnum_va = num_pre.transform(ds.val).astype("float32")
    maps, cards = _fit_cat_maps(tr)
    Xcat_tr = _encode_cat(tr, maps)
    Xcat_va = _encode_cat(ds.val, maps)
    ytr = tr["MADE"].values.astype("float32")
    wtr = ds.weights(tr)
    wtr = (np.ones(len(ytr), dtype="float32") if wtr is None
           else wtr.astype("float32"))
    yva = ds.val["MADE"].values.astype("float32")

    device = "cuda" if (getattr(dp, "use_gpu", False) and torch.cuda.is_available()) else "cpu"
    model = TabularMLP(cards, Xnum_tr.shape[1],
                       hidden=tuple(dp.hidden), p=tuple(dp.dropout)).to(device)
    train_ds = TensorDataset(torch.from_numpy(Xcat_tr), torch.from_numpy(Xnum_tr),
                             torch.from_numpy(ytr), torch.from_numpy(wtr))
    dl = DataLoader(train_ds, batch_size=dp.batch_size, shuffle=True,
                    pin_memory=(device == "cuda"))
    opt = torch.optim.Adam(model.parameters(), lr=dp.lr,
                           weight_decay=getattr(dp, "weight_decay", 0.0))
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=dp.max_epochs)
    # per-sample so the recency weight can be applied before reducing
    loss_fn = nn.BCEWithLogitsLoss(reduction="none")
    xc_va = torch.from_numpy(Xcat_va).to(device)
    xn_va = torch.from_numpy(Xnum_va).to(device)
    print(f"  training MLP on {device.upper()} | {len(tr):,} rows | "
          f"up to {dp.max_epochs} epochs")

    best_auc, best_state, bad = -1.0, None, 0
    for epoch in range(dp.max_epochs):
        model.train()
        for xc, xn, y, w in dl:
            xc, xn, y, w = xc.to(device), xn.to(device), y.to(device), w.to(device)
            opt.zero_grad()
            loss = (loss_fn(model(xc, xn), y) * w).sum() / w.sum()
            loss.backward()
            opt.step()
        sched.step()
        model.eval()
        with torch.no_grad():
            p = torch.sigmoid(model(xc_va, xn_va)).cpu().numpy()
        auc = roc_auc_score(yva, p)
        if auc > best_auc + 1e-5:
            best_auc = auc
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            bad = 0
        else:
            bad += 1
            if bad >= dp.patience:
                print(f"    early stop at epoch {epoch + 1}")
                break
        if (epoch + 1) % 10 == 0:
            print(f"    epoch {epoch + 1:>3}  val AUC {auc:.4f}  (best {best_auc:.4f})")
    if best_state:
        model.load_state_dict(best_state)
    model.to("cpu").eval()  # serve on CPU (tiny model, robust to no-GPU hosts)
    print(f"  mlp best val AUC {best_auc:.4f}")
    return {"name": "mlp", "kind": "deep", "model": model,
            "num_pre": num_pre, "cat_maps": maps}


def predict_proba_deep(bundle: dict, X: pd.DataFrame) -> np.ndarray:
    Xnum = bundle["num_pre"].transform(X).astype("float32")
    Xcat = _encode_cat(X, bundle["cat_maps"])
    bundle["model"].eval()
    with torch.no_grad():
        logit = bundle["model"](torch.from_numpy(Xcat), torch.from_numpy(Xnum))
        return torch.sigmoid(logit).numpy()
