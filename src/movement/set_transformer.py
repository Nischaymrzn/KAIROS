"""Set-Transformer for shot-quality over the defender SET (Lee et al., ICML 2019).

The core model is blind to defender geometry; the boosting tracking study hand-
engineers it into scalars (closest defender, 2nd-closest, angle, help count). This
model instead consumes the RAW set of up-to-9 players at the release frame and is
**permutation-invariant** over them: a stacked Set-Attention-Block encoder lets the
players attend to each other (so it can represent help defence, spacing, a defender
sitting in the shot line), then Pooling-by-Multihead-Attention collapses the set to
one vector, fused with the (non-geometry) shot context. This is the one place a
modern architecture has the right inductive bias that gradient boosting lacks —
trees cannot model an unordered, variable-size set of players; this can.

Masking excludes padded players from every attention so set size varies per shot.
"""
from __future__ import annotations
import math

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.metrics import roc_auc_score


class MAB(nn.Module):
    """Multihead Attention Block: Q attends to K, residual + FF (Set Transformer)."""

    def __init__(self, dq: int, dk: int, d: int, heads: int):
        super().__init__()
        self.d, self.heads = d, heads
        self.fq = nn.Linear(dq, d); self.fk = nn.Linear(dk, d); self.fv = nn.Linear(dk, d)
        self.ln0 = nn.LayerNorm(d); self.ln1 = nn.LayerNorm(d)
        self.ff = nn.Sequential(nn.Linear(d, d), nn.ReLU(), nn.Linear(d, d))

    def forward(self, Q, K, key_mask=None):
        Qh, Kh, Vh = self.fq(Q), self.fk(K), self.fv(K)
        B, nq, _ = Qh.shape; nk = Kh.shape[1]; h = self.heads; dh = self.d // h
        Qh = Qh.view(B, nq, h, dh).transpose(1, 2)
        Kh = Kh.view(B, nk, h, dh).transpose(1, 2)
        Vh = Vh.view(B, nk, h, dh).transpose(1, 2)
        scores = (Qh @ Kh.transpose(-2, -1)) / math.sqrt(dh)      # B,h,nq,nk
        if key_mask is not None:
            m = key_mask[:, None, None, :].bool()
            scores = scores.masked_fill(~m, float("-inf"))
        A = torch.nan_to_num(torch.softmax(scores, dim=-1))
        O = (A @ Vh).transpose(1, 2).contiguous().view(B, nq, self.d)
        H = self.ln0(self.fq(Q) + O)
        return self.ln1(H + self.ff(H))


class SAB(nn.Module):
    def __init__(self, d, heads): super().__init__(); self.mab = MAB(d, d, d, heads)
    def forward(self, X, mask=None): return self.mab(X, X, mask)


class PMA(nn.Module):
    def __init__(self, d, heads, k=1):
        super().__init__()
        self.S = nn.Parameter(torch.randn(1, k, d)); self.mab = MAB(d, d, d, heads)
    def forward(self, X, mask=None):
        return self.mab(self.S.repeat(X.shape[0], 1, 1), X, mask)


class SetShotModel(nn.Module):
    def __init__(self, n_set_feat, n_context, d=64, heads=4, blocks=2, dropout=0.2):
        super().__init__()
        self.embed = nn.Linear(n_set_feat, d)
        self.enc = nn.ModuleList([SAB(d, heads) for _ in range(blocks)])
        self.pma = PMA(d, heads, k=1)
        self.ctx = nn.Sequential(nn.Linear(n_context, d), nn.ReLU(),
                                 nn.Linear(d, d), nn.ReLU())
        self.head = nn.Sequential(nn.Linear(2 * d, d), nn.ReLU(),
                                  nn.Dropout(dropout), nn.Linear(d, 1))

    def forward(self, S, mask, ctx):
        X = self.embed(S)
        for sab in self.enc:
            X = sab(X, mask)
        pooled = self.pma(X, mask).squeeze(1)
        return self.head(torch.cat([pooled, self.ctx(ctx)], dim=-1)).squeeze(-1)


class SetScaler:
    """Standardise set features (over real players) and context (fit on train)."""
    def fit(self, S, mask, ctx):
        real = mask.reshape(-1).astype(bool)
        flat = S.reshape(-1, S.shape[-1])[real]
        self.s_mean = flat.mean(0); self.s_std = flat.std(0); self.s_std[self.s_std < 1e-6] = 1.0
        self.c_mean = ctx.mean(0); self.c_std = ctx.std(0); self.c_std[self.c_std < 1e-6] = 1.0
        return self
    def set(self, S, mask):
        out = np.nan_to_num((S - self.s_mean) / self.s_std).astype("float32")
        return out * mask[..., None]          # keep padded rows at 0
    def con(self, ctx):
        return np.nan_to_num((ctx - self.c_mean) / self.c_std).astype("float32")


def train_set_model(td, context_cols, d=64, heads=4, blocks=2, epochs=80,
                    lr=1e-3, batch=512, patience=12, seed=42, warmup=5):
    """Train the Set-Transformer; early-stop on validation AUC. Returns
    (bundle, val_auc). bundle carries the model + scaler + context columns.

    Transformers need a fair regimen to converge stably: linear LR warmup then
    cosine decay, and gradient-norm clipping. Without these the model plateaus
    early and understates what the architecture can do — so the honest comparison
    against gradient boosting requires them.
    """
    torch.manual_seed(seed); np.random.seed(seed)
    dev = "cuda" if torch.cuda.is_available() else "cpu"

    Ctr = td.train[context_cols].to_numpy("float32")
    Cva = td.val[context_cols].to_numpy("float32")
    sc = SetScaler().fit(td.set_tr, td.mask_tr, Ctr)
    Str, Sva = sc.set(td.set_tr, td.mask_tr), sc.set(td.set_va, td.mask_va)
    Ctr, Cva = sc.con(Ctr), sc.con(Cva)
    ytr = td.train["MADE"].to_numpy("float32")
    yva = td.val["MADE"].to_numpy("float32")

    model = SetShotModel(td.set_tr.shape[-1], len(context_cols), d, heads, blocks).to(dev)
    dl = DataLoader(TensorDataset(torch.from_numpy(Str), torch.from_numpy(td.mask_tr),
                                  torch.from_numpy(Ctr), torch.from_numpy(ytr)),
                    batch_size=batch, shuffle=True, drop_last=True)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-5)

    def _lr_scale(ep):                       # linear warmup -> cosine decay
        if ep < warmup:
            return (ep + 1) / warmup
        prog = (ep - warmup) / max(1, epochs - warmup)
        return 0.5 * (1.0 + math.cos(math.pi * prog))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, _lr_scale)
    loss_fn = nn.BCEWithLogitsLoss()
    vS = torch.from_numpy(Sva).to(dev); vM = torch.from_numpy(td.mask_va).to(dev)
    vC = torch.from_numpy(Cva).to(dev)
    print(f"  Set-Transformer on {dev.upper()} | train {len(ytr):,} | "
          f"d={d} heads={heads} blocks={blocks} | up to {epochs} epochs "
          f"(warmup {warmup}, cosine, grad-clip)")

    best, best_state, bad = 0.0, None, 0
    for ep in range(epochs):
        model.train()
        for s, m, c, y in dl:
            s, m, c, y = s.to(dev), m.to(dev), c.to(dev), y.to(dev)
            opt.zero_grad()
            loss_fn(model(s, m, c), y).backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        sched.step()
        model.eval()
        with torch.no_grad():
            pv = torch.sigmoid(model(vS, vM, vC)).cpu().numpy()
        auc = roc_auc_score(yva, pv)
        if auc > best + 1e-4:
            best, bad = auc, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
        if (ep + 1) % 5 == 0:
            print(f"    epoch {ep + 1:>2}  val AUC {auc:.4f}  (best {best:.4f})")
        if bad >= patience:
            print(f"    early stop at epoch {ep + 1}")
            break
    if best_state:
        model.load_state_dict(best_state)
    model.to(dev).eval()
    return {"model": model, "scaler": sc, "context": list(context_cols),
            "device": dev, "kind": "set"}, best


def predict_set(bundle, td_part_df, set_arr, mask_arr) -> np.ndarray:
    sc, model, dev = bundle["scaler"], bundle["model"], bundle["device"]
    S = sc.set(set_arr, mask_arr)
    C = sc.con(td_part_df[bundle["context"]].to_numpy("float32"))
    model.eval()
    with torch.no_grad():
        out = []
        for i in range(0, len(S), 4096):
            s = torch.from_numpy(S[i:i+4096]).to(dev)
            m = torch.from_numpy(mask_arr[i:i+4096]).to(dev)
            c = torch.from_numpy(C[i:i+4096]).to(dev)
            out.append(torch.sigmoid(model(s, m, c)).cpu().numpy())
    return np.concatenate(out)
