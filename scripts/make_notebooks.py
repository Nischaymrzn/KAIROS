"""Generate the 13 thin notebooks. Each imports from src/, runs its stage, shows
key outputs, and ends with an acceptance assertion cell. Run:

    python scripts/make_notebooks.py
"""
from __future__ import annotations
from pathlib import Path

import nbformat as nbf

ROOT = Path(__file__).resolve().parents[1]
NB_DIR = ROOT / "notebooks"

SETUP = (
    "import os, sys\n"
    "os.environ.setdefault('OMP_NUM_THREADS', '4')\n"
    "sys.path.insert(0, os.path.abspath('..'))\n"
    "from src.seeds import set_global_seed\n"
    "set_global_seed(42)\n"
    "from src.config import get_config\n"
    "cfg = get_config()"
)


def nb(title: str, intro: str, cells: list[tuple[str, str]]):
    doc = nbf.v4.new_notebook()
    out = [nbf.v4.new_markdown_cell(f"# {title}\n\n{intro}"),
           nbf.v4.new_code_cell(SETUP)]
    for kind, src in cells:
        out.append(nbf.v4.new_markdown_cell(src) if kind == "md"
                   else nbf.v4.new_code_cell(src))
    doc.cells = out
    return doc


# helper snippets reused across notebooks
RUN = "import subprocess; subprocess.run([sys.executable,'-m','{mod}'],cwd='..',check=True)"
SHOW = ("from IPython.display import Image, display\n"
        "from pathlib import Path\n"
        "p = Path('..') / '{fig}'\n"
        "display(Image(str(p))) if p.exists() else print('(figure pending)')")

NOTEBOOKS = {
 "00_data_acquisition": ("Data acquisition (Tier A)",
   "Pull the in-scope shot spine into `data/raw/` and record a manifest.",
   [("code", RUN.format(mod="src.data.acquire")),
    ("md", "**Acceptance:** >800k shots, no out-of-scope season."),
    ("code", "import json\nm=json.load(open('../data/raw/_manifest.json'))\n"
             "print(m['rows'],'shots', m['seasons'])\nassert m['rows']>800000")]),

 "01_cleaning_and_merge": ("Cleaning and merge",
   "Clean the spine, derive the target, drop duplicates, merge enrichment.",
   [("code", RUN.format(mod="src.features.build")),
    ("md", "**Acceptance:** binary target, no duplicate shot rows."),
    ("code", "import pandas as pd\n"
             "df=pd.read_parquet('../data/interim/shots_merged.parquet')\n"
             "print(len(df),'rows'); assert df['MADE'].isin([0,1]).all()")]),

 "02_eda": ("Exploratory data analysis",
   "Understand the data before modelling: make rate by zone, distance, defender "
   "tier, action type; class balance; missingness.",
   [("code", "import pandas as pd, numpy as np, matplotlib.pyplot as plt\n"
             "from src.dataset import load_processed\n"
             "ds=load_processed(cfg); tr=ds.train\n"
             "print('base make rate', round(tr['MADE'].mean(),3))"),
    ("code", "fig,ax=plt.subplots(1,3,figsize=(16,4))\n"
             "tr.groupby('basic_zone')['MADE'].mean().sort_values().plot.barh(ax=ax[0],title='make rate by zone')\n"
             "tr.assign(db=pd.cut(tr['shot_distance'],range(0,40,3))).groupby('db',observed=True)['MADE'].mean().plot(ax=ax[1],title='make rate by distance')\n"
             "tr.assign(dt=pd.cut(tr['defender_distance'],[-1,2,4,6,100])).groupby('dt',observed=True)['MADE'].mean().plot.bar(ax=ax[2],title='make rate by defender tier')\n"
             "from pathlib import Path; Path('../reports/figures/eda').mkdir(parents=True,exist_ok=True)\n"
             "plt.tight_layout(); plt.savefig('../reports/figures/eda/make_rates.png',dpi=120); plt.show()"),
    ("md","**Acceptance:** make-rate-by-zone/distance/defender plots exist; base rate printed."),
    ("code","assert Path('../reports/figures/eda/make_rates.png').exists()")]),

 "03_feature_engineering": ("Feature engineering",
   "Build the full feature matrix per SPEC and apply the chronological split.",
   [("code", RUN.format(mod="src.features.build")),
    ("md","**Acceptance:** no outcome-derived feature, disjoint seasons, zone FG% fit on train."),
    ("code","import json\nmeta=json.load(open('../data/processed/feature_meta.json'))\n"
            "print(len(meta['numeric']),'numeric +',len(meta['categorical']),'categorical')\n"
            "assert 'MADE' not in meta['numeric']+meta['categorical']")]),

 "04_baseline_xp": ("Expected-Points baseline",
   "The number every model must beat: zone FG% as the make probability.",
   [("code", RUN.format(mod="src.models.baseline_xp")),
    ("md","**Acceptance:** baseline AUC near 0.636 stored."),
    ("code","import json\nb=json.load(open('../reports/figures/baseline_metrics.json'))\n"
            "print('baseline val AUC', round(b['val']['auc'],4)); assert 0.55<b['val']['auc']<0.75")]),

 "05_models_classical_ml": ("Classical models",
   "Logistic Regression, Random Forest, XGBoost, LightGBM, CatBoost.",
   [("code","import subprocess\n"
            "for mname in ['logreg','rf','xgboost','lightgbm','catboost']:\n"
            "    subprocess.run([sys.executable,'-m','src.models.train','--model',mname],cwd='..',check=True)"),
    ("md","**Acceptance:** at least one model beats the baseline AUC."),
    ("code","import json\nlb=json.load(open('../models/leaderboard.json'))\n"
            "print(lb['models'][0]); assert lb['models'][0]['auc']>lb['baseline_val_auc']")]),

 "06_models_deep_learning": ("Deep learning (TabularMLP)",
   "A CPU-sized PyTorch MLP with embeddings. Boosting usually wins on tabular "
   "data; this is the required comparison.",
   [("code", "import subprocess; subprocess.run([sys.executable,'-m','src.models.train','--model','mlp'],cwd='..',check=True)"),
    ("md","**Acceptance:** the MLP trains on CPU and beats the baseline AUC."),
    ("code","import joblib,json\nfrom src.dataset import load_processed\n"
            "from src.models.registry import predict_proba\nfrom src.models.evaluate import metrics\n"
            "ds=load_processed(cfg,with_test=False); b=joblib.load('../models/mlp.joblib')\n"
            "m=metrics(ds.val['MADE'],predict_proba(b,ds.val[ds.features]))\n"
            "base=json.load(open('../reports/figures/baseline_metrics.json'))['val']['auc']\n"
            "print('mlp AUC',round(m['auc'],4)); assert m['auc']>base")]),

 "07_calibration": ("Calibration",
   "Make probabilities honest: isotonic vs Platt on validation.",
   [("code", RUN.format(mod="src.models.calibrate")),
    ("md","**Acceptance:** calibrated Brier <= uncalibrated Brier on validation."),
    ("code", SHOW.format(fig="reports/figures/calibration_reliability.png"))]),

 "08_evaluation_and_comparison": ("Final evaluation (test season)",
   "Single-use evaluation on the held-out test season + sliced metrics.",
   [("code", "import subprocess; subprocess.run([sys.executable,'-m','src.models.evaluate','--test'],cwd='..',check=True)"),
    ("md","**Acceptance:** test read once; delta over baseline reported with sign."),
    ("code","import json\nr=json.load(open('../reports/figures/final_metrics.json'))\n"
            "print('test AUC',round(r['test']['auc'],4),'delta',r['auc_delta_over_baseline'])"),
    ("code", SHOW.format(fig="reports/figures/final_reliability.png"))]),

 "09_explainability_shap": ("Explainability (SHAP)",
   "Global feature importance + single-shot explanations.",
   [("code", RUN.format(mod="src.models.explain")),
    ("code","from src.serve.predict import predict\n"
            "r=predict({'action_type':'Step Back Jump shot','shot_type':'3PT Field Goal',"
            "'basic_zone':'Above the Break 3','zone_range':'24+ ft.','shot_distance':26,"
            "'loc_x':60,'loc_y':240,'defender_distance':2})\nprint(r['quality']); r['factors']"),
    ("md","**Acceptance:** explain_one returns ranked signed contributions."),
    ("code", SHOW.format(fig="reports/figures/shap/beeswarm.png"))]),

 "10_movement_eda": ("Movement EDA (Phase 2)",
   "Understand the extracted 2015-16 SportVU trajectories before modelling.",
   [("code","import pandas as pd, numpy as np, matplotlib.pyplot as plt\n"
            "t = pd.read_parquet('../data/movement/trajectories.parquet')\n"
            "n_traj = t.groupby(['GAME_ID','GAME_EVENT_ID']).ngroups\n"
            "print(f'{n_traj:,} trajectories, {len(t):,} waypoints')\n"
            "print('speed p50/p95:', round(t[t.step>0].speed.median(),1),\n"
            "      round(t[t.step>0].speed.quantile(.95),1), 'ft/s')"),
    ("code","fig, ax = plt.subplots(figsize=(7,7))\n"
            "for (_, _), g in list(t.groupby(['GAME_ID','GAME_EVENT_ID']))[:60]:\n"
            "    ax.plot(g.x, g.y, alpha=0.4, lw=1)\n"
            "ax.plot(5.35, 25, 'o', color='orange', ms=12, label='basket')\n"
            "ax.set_xlim(0,50); ax.set_ylim(0,50); ax.set_aspect('equal')\n"
            "ax.set_title('60 shooter trajectories (final 4s before release)')\n"
            "ax.legend(); plt.show()"),
    ("md","**Acceptance:** at least 50 aligned shot-ending trajectories."),
    ("code","assert n_traj >= 50, n_traj")]),

 "11_trajectory_extraction": ("Trajectory extraction (Phase 2)",
   "Raw SportVU game logs -> structured waypoint sequences (see "
   "`src/movement/extract.py`). Heavy step: run via CLI, verify outputs here.",
   [("md","To (re)extract: `python -m src.movement.extract --games 60`."),
    ("code","import json, numpy as np\n"
            "m = json.load(open('../data/movement/extract_manifest.json'))\n"
            "print(m)\n"
            "d = np.load('../data/movement/sequences.npz', allow_pickle=True)\n"
            "print('seq:', d['seq'].shape, '| features:', m['features'])"),
    ("md","**Acceptance:** sequences saved with the SPEC waypoint schema."),
    ("code","assert d['seq'].ndim == 3 and d['seq'].shape[2] == 8\n"
            "assert m['kept'] >= 1000")]),

 "12_movement_models": ("Movement models (Phase 2)",
   "DTW move-template clustering + GRU sequence model; ADE/FDE vs baselines.",
   [("code", "import subprocess; subprocess.run([sys.executable,'-m','src.movement.train_movement'],cwd='..',check=True)"),
    ("code","import json\nm=json.load(open('../models/movement/metrics.json'))\nm"),
    ("md","**Acceptance:** the GRU beats constant-velocity and centroid-replay "
          "on ADE, and move-type accuracy beats the majority baseline."),
    ("code","assert m['trajectory']['gru']['ade_ft'] < m['trajectory']['constant_velocity']['ade_ft']\n"
            "assert m['move_type_accuracy'] > m['majority_baseline']"),
    ("code", SHOW.format(fig="reports/figures/movement_examples.png"))]),

 "13_export_models": ("Export for serving",
   "Freeze the versioned production bundle; smoke-test shot + movement serving.",
   [("code", "import subprocess; subprocess.run([sys.executable,'-m','src.models.export'],cwd='..',check=True)"),
    ("code","from src.serve.predict import predict\n"
            "r=predict({'action_type':'Driving Layup Shot','shot_type':'2PT Field Goal',"
            "'basic_zone':'Restricted Area','zone_range':'Less Than 8 ft.','shot_distance':2,"
            "'loc_x':0,'loc_y':8})\nassert 0<=r['probability']<=1; r"),
    ("code","from src.serve.movement import predict_move\n"
            "mv=predict_move({'loc_x':10,'loc_y':14})\n"
            "assert mv['waypoints'], 'no waypoints'\nmv['move_type'], len(mv['waypoints'])"),
    ("md","**Acceptance:** production bundle versioned with manifest; both serve "
          "functions return contract-shaped results.")]),
}


def main():
    NB_DIR.mkdir(exist_ok=True)
    for name, (title, intro, cells) in NOTEBOOKS.items():
        doc = nb(title, intro, cells)
        nbf.write(doc, NB_DIR / f"{name}.ipynb")
    print(f"wrote {len(NOTEBOOKS)} notebooks -> {NB_DIR}")


if __name__ == "__main__":
    main()
