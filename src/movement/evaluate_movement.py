"""Trajectory-prediction metrics: ADE, FDE, and move-type accuracy."""
from __future__ import annotations
import numpy as np


def ade(pred: np.ndarray, true: np.ndarray, mask: np.ndarray | None = None) -> float:
    """Average Displacement Error: mean step-wise distance.
    pred/true: (N, T, 2). mask: (N, T) of valid steps (optional)."""
    d = np.linalg.norm(pred - true, axis=-1)          # (N, T)
    if mask is not None:
        return float((d * mask).sum() / np.clip(mask.sum(), 1, None))
    return float(d.mean())


def fde(pred: np.ndarray, true: np.ndarray, lengths: np.ndarray | None = None) -> float:
    """Final Displacement Error: distance at the release point."""
    if lengths is None:
        last_pred, last_true = pred[:, -1], true[:, -1]
    else:
        idx = (lengths - 1).astype(int)
        last_pred = pred[np.arange(len(pred)), idx]
        last_true = true[np.arange(len(true)), idx]
    return float(np.linalg.norm(last_pred - last_true, axis=-1).mean())


def move_type_accuracy(pred_labels, true_labels) -> float:
    pred_labels = np.asarray(pred_labels)
    true_labels = np.asarray(true_labels)
    return float((pred_labels == true_labels).mean())


def majority_baseline_accuracy(true_labels) -> float:
    vals, counts = np.unique(np.asarray(true_labels), return_counts=True)
    return float(counts.max() / counts.sum())
