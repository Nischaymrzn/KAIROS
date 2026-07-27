import sys
from pathlib import Path

import pytest

# make `src` importable when running pytest from anywhere
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Training-WORKSPACE tests (feature tables, split integrity, leakage audits)
# need data/processed/*, which experiments may rebuild or clear — the deployable
# artifact is the frozen bundle, and serving no longer depends on the workspace.
# In a bundle-only checkout these tests SKIP with a reason instead of failing.
_WORKSPACE_MODULES = {"test_features", "test_no_leakage", "test_splits"}
_WORKSPACE_PRESENT = (ROOT / "data" / "processed" / "train.parquet").exists()


def pytest_collection_modifyitems(config, items):
    if _WORKSPACE_PRESENT:
        return
    skip = pytest.mark.skip(
        reason="training workspace (data/processed) not present — bundle-only "
               "deployment; rebuild with `make features` to run these"
    )
    for item in items:
        if item.module.__name__ in _WORKSPACE_MODULES:
            item.add_marker(skip)
