"""GRU encoder-decoder that predicts the next k court positions of a move.
Observed prefix (all waypoint features) -> autoregressive (x, y) rollout.
Trains on GPU when available; sequences are short so CPU also works."""
from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset


class TrajectoryGRU(nn.Module):
    """Encode the observed prefix, then decode `horizon` future positions."""

    def __init__(self, in_dim: int, hidden: int = 96, horizon: int = 12):
        super().__init__()
        self.horizon = horizon
        self.enc = nn.GRU(in_dim, hidden, batch_first=True)
        self.dec = nn.GRUCell(2, hidden)
        self.head = nn.Linear(hidden, 2)

    def forward(self, prefix: torch.Tensor, teacher: torch.Tensor | None = None):
        _, h = self.enc(prefix)
        h = h.squeeze(0)
        last = prefix[:, -1, :2]           # last observed (x, y)
        outs = []
        for t in range(self.horizon):
            h = self.dec(last, h)
            step = self.head(h) + last     # residual: predict the delta
            outs.append(step)
            last = teacher[:, t] if teacher is not None else step
        return torch.stack(outs, dim=1)    # (B, horizon, 2)


def _ade(pred: torch.Tensor, true: torch.Tensor) -> float:
    return float(torch.linalg.norm(pred - true, dim=-1).mean())


def train_gru(prefix: np.ndarray, target: np.ndarray,
              val_prefix: np.ndarray, val_target: np.ndarray,
              hidden: int = 96, epochs: int = 60, lr: float = 1e-3,
              batch: int = 256, patience: int = 8, seed: int = 42):
    """Train with teacher forcing; early-stop on validation ADE (free-running).
    Returns (model, best_val_ade)."""
    torch.manual_seed(seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = TrajectoryGRU(prefix.shape[2], hidden, target.shape[1]).to(device)
    dl = DataLoader(TensorDataset(torch.from_numpy(prefix),
                                  torch.from_numpy(target)),
                    batch_size=batch, shuffle=True)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.MSELoss()
    vp = torch.from_numpy(val_prefix).to(device)
    vt = torch.from_numpy(val_target).to(device)
    print(f"  GRU on {device.upper()} | train {len(prefix):,} | "
          f"horizon {target.shape[1]} | up to {epochs} epochs")

    best, best_state, bad = float("inf"), None, 0
    for ep in range(epochs):
        model.train()
        for xp, xt in dl:
            xp, xt = xp.to(device), xt.to(device)
            opt.zero_grad()
            loss = loss_fn(model(xp, teacher=xt), xt)
            loss.backward()
            opt.step()
        model.eval()
        with torch.no_grad():
            ade = _ade(model(vp), vt)
        if ade < best - 1e-4:
            best, bad = ade, 0
            best_state = {k: v.detach().cpu().clone()
                          for k, v in model.state_dict().items()}
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


def predict_gru(model: TrajectoryGRU, prefix: np.ndarray) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        return model(torch.from_numpy(prefix)).numpy()
