"""Cluster trajectories into canonical move templates (drive left/right, pull-up
rise, step-back retreat). Uses tslearn DTW k-means if available, else falls back
to k-means on the flattened sequences. Phase 2."""
from __future__ import annotations
import numpy as np


def cluster_trajectories(seq: np.ndarray, k: int = 6, seed: int = 42):
    """seq: (N, T, F). Returns (labels, centroids)."""
    try:
        from tslearn.clustering import TimeSeriesKMeans
        km = TimeSeriesKMeans(n_clusters=k, metric="dtw", random_state=seed,
                              max_iter=10)
        labels = km.fit_predict(seq[:, :, :2])      # cluster on x,y path
        return labels, km.cluster_centers_
    except ImportError:
        from sklearn.cluster import KMeans
        flat = seq[:, :, :2].reshape(len(seq), -1)
        km = KMeans(n_clusters=k, random_state=seed, n_init=10).fit(flat)
        cents = km.cluster_centers_.reshape(k, seq.shape[1], 2)
        return km.labels_, cents
