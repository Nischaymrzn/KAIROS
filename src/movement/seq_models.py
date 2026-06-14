"""Advanced sequence models for trajectory prediction — LSTM encoder-decoder and
a Transformer — to compare against the GRU (`sequence_model.py`) and the
constant-velocity / template baselines. All predict `horizon` future (x, y)
positions from the observed prefix, as residual deltas so they extrapolate the
player's motion rather than memorising absolute court positions.

Shared training loop (`train_seq`): teacher-forced where the model supports it,
early-stopped on free-running validation ADE (feet). GPU when available.
"""
from __future__ import annotations
import math

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset


def _device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


class TrajectoryLSTM(nn.Module):
    """LSTM encoder + LSTMCell decoder, residual (x,y)-delta decoding."""

    def __init__(self, in_dim: int, hidden: int = 96, horizon: int = 12):
        super().__init__()
        self.horizon = horizon
        self.enc = nn.LSTM(in_dim, hidden, batch_first=True)
        self.dec = nn.LSTMCell(2, hidden)
        self.head = nn.Linear(hidden, 2)

    def forward(self, prefix, teacher=None):
        _, (h, c) = self.enc(prefix)
        h, c = h.squeeze(0), c.squeeze(0)
        last = prefix[:, -1, :2]
        outs = []
        for t in range(self.horizon):
            h, c = self.dec(last, (h, c))
            step = self.head(h) + last
            outs.append(step)
            last = teacher[:, t] if teacher is not None else step
        return torch.stack(outs, dim=1)


class _PosEnc(nn.Module):
    def __init__(self, d, max_len=64):
        super().__init__()
        pe = torch.zeros(max_len, d)
        pos = torch.arange(max_len).unsqueeze(1).float()
        div = torch.exp(torch.arange(0, d, 2).float() * (-math.log(10000.0) / d))
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer("pe", pe.unsqueeze(0))

    def forward(self, x):
        return x + self.pe[:, : x.size(1)]


class TrajectoryTransformer(nn.Module):
    """Transformer encoder over the prefix; `horizon` learned queries cross-attend
    to it and predict residual (x,y) deltas from the last observed point."""

    def __init__(self, in_dim: int, d_model: int = 64, nhead: int = 4,
                 layers: int = 2, horizon: int = 12):
        super().__init__()
        self.horizon = horizon
        self.inp = nn.Linear(in_dim, d_model)
        self.pos = _PosEnc(d_model)
        enc = nn.TransformerEncoderLayer(d_model, nhead, d_model * 2,
                                         dropout=0.1, batch_first=True)
        self.encoder = nn.TransformerEncoder(enc, layers)
        self.query = nn.Parameter(torch.randn(horizon, d_model) * 0.02)
        dec = nn.TransformerDecoderLayer(d_model, nhead, d_model * 2,
                                         dropout=0.1, batch_first=True)
        self.decoder = nn.TransformerDecoder(dec, layers)
        self.head = nn.Linear(d_model, 2)

    def forward(self, prefix, teacher=None):
        mem = self.encoder(self.pos(self.inp(prefix)))
        q = self.query.unsqueeze(0).expand(prefix.size(0), -1, -1)
        dec = self.decoder(q, mem)
        deltas = self.head(dec)                       # (B, horizon, 2) residuals
        return prefix[:, -1:, :2] + torch.cumsum(deltas, dim=1)


def _ade(pred, true) -> float:
    return float(torch.linalg.norm(pred - true, dim=-1).mean())


def train_seq(model, prefix, target, val_prefix, val_target, *, epochs=80,
              lr=1e-3, batch=256, patience=12, teacher_forcing=True, seed=42,
              warmup=5):
    """Train any of the sequence models; early-stop on free-running val ADE.

    Uses the fair deep-training regimen (linear LR warmup -> cosine decay, gradient-
    norm clipping): recurrent and especially attention models plateau early and
    understate their capacity without it, so a fair GRU-vs-LSTM-vs-Transformer
    comparison requires giving each the same proper schedule."""
    torch.manual_seed(seed)
    dev = _device()
    model = model.to(dev)
    dl = DataLoader(TensorDataset(torch.from_numpy(prefix), torch.from_numpy(target)),
                    batch_size=batch, shuffle=True)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-5)

    def _scale(ep):
        if ep < warmup:
            return (ep + 1) / warmup
        prog = (ep - warmup) / max(1, epochs - warmup)
        return 0.5 * (1.0 + math.cos(math.pi * prog))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, _scale)
    loss_fn = nn.MSELoss()
    vp = torch.from_numpy(val_prefix).to(dev)
    vt = torch.from_numpy(val_target).to(dev)
    print(f"  {model.__class__.__name__} on {dev.upper()} | train {len(prefix):,} "
          f"| {epochs} epochs (warmup {warmup}, cosine, grad-clip)")

    best, best_state, bad = float("inf"), None, 0
    for ep in range(epochs):
        model.train()
        for xp, xt in dl:
            xp, xt = xp.to(dev), xt.to(dev)
            opt.zero_grad()
            tf = xt if teacher_forcing else None
            loss = loss_fn(model(xp, teacher=tf), xt)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        sched.step()
        model.eval()
        with torch.no_grad():
            ade = _ade(model(vp), vt)
        if not math.isfinite(ade):        # a rare attention blow-up: never keep NaN
            bad += 1
            if bad >= patience:
                print(f"    early stop at epoch {ep + 1} (non-finite val)")
                break
            continue
        if ade < best - 1e-4:
            best, bad = ade, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= patience:
                print(f"    early stop at epoch {ep + 1}")
                break
        if (ep + 1) % 10 == 0:
            print(f"    epoch {ep + 1:>3}  val ADE {ade:.3f} ft (best {best:.3f})")
    if best_state:
        model.load_state_dict(best_state)
    model.to("cpu").eval()
    return model, best


def predict_seq(model, prefix) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        return model(torch.from_numpy(prefix.astype("float32"))).numpy()
