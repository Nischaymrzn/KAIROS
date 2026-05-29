"""Global determinism helpers."""
from __future__ import annotations
import os
import random

import numpy as np


def set_global_seed(seed: int = 42, torch_deterministic: bool = False) -> None:
    """Seed Python, NumPy and (if available) torch for reproducibility."""
    os.environ.setdefault("PYTHONHASHSEED", str(seed))
    random.seed(seed)
    np.random.seed(seed)
    try:
        import torch

        torch.manual_seed(seed)
        torch.set_num_threads(os.cpu_count() or 4)
        if torch_deterministic:
            try:
                torch.use_deterministic_algorithms(True)
            except Exception:
                pass
    except ImportError:
        pass
