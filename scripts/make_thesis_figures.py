"""Regenerate every thesis figure from the frozen artifacts, in one command.

Each figure is produced by an existing module; this orchestrator calls them so a
single run refreshes the whole evidence pack. Individual failures are reported
but do not abort the rest.

Run:  python scripts/make_thesis_figures.py
Figures land in reports/figures/.
"""
from __future__ import annotations
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import get_config  # noqa: E402


def _step(name: str, fn) -> bool:
    print(f"[figures] {name} ...", end=" ", flush=True)
    try:
        fn()
        print("ok")
        return True
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        traceback.print_exc(limit=1)
        return False


def _reliability_and_metrics():
    from src.models.evaluate import final_evaluation
    final_evaluation()  # writes final_reliability.png + final_metrics.json


def _shap():
    from src.models.explain import global_shap
    global_shap(n=3000)


def _defender_study():
    from src.studies.defender_2015 import main as defender_main
    defender_main()


def _leaderboard_bar():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    cfg = get_config()
    board = json.loads((cfg.path("models") / "leaderboard.json").read_text())
    models = board.get("models", [])
    if not models:
        raise RuntimeError("empty leaderboard.json")
    names = [m["name"] for m in models]
    aucs = [m["auc"] for m in models]
    base = board.get("baseline_val_auc")
    fig, ax = plt.subplots(figsize=(6.5, 4))
    ax.barh(names[::-1], aucs[::-1], color="#3b82f6")
    if base:
        ax.axvline(base, color="#ef4444", ls="--", label=f"xP baseline {base:.3f}")
        ax.legend()
    ax.set_xlabel("validation AUC")
    ax.set_xlim(min(aucs + [base or 0.6]) - 0.01, max(aucs) + 0.005)
    ax.set_title("Model comparison (validation AUC)")
    fig.tight_layout()
    fig.savefig(cfg.path("figures") / "leaderboard_auc.png", dpi=130)
    plt.close(fig)


def main() -> int:
    print("Regenerating thesis figures -> reports/figures/\n")
    ok = 0
    ok += _step("reliability + final metrics (reads test once)", _reliability_and_metrics)
    ok += _step("SHAP global (beeswarm + bar)", _shap)
    ok += _step("model-comparison leaderboard bar", _leaderboard_bar)
    ok += _step("2014-15 defender study", _defender_study)
    print("\nNote: movement_examples.png is produced by `make movement-train`.")
    print(f"[figures] {ok}/4 steps ok. See reports/figures/.")
    return 0 if ok == 4 else 1


if __name__ == "__main__":
    raise SystemExit(main())
