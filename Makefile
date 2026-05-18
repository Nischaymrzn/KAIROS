# HoopIQ ML pipeline — one-line commands. Run from the repo root.
PY = python

.PHONY: setup data validate-data features baseline train calibrate evaluate explain serve api tune defender-study figures learning-curve ablation ab-skill ab-catboost-cats ab-opponent-zone leaderboard-ci robustness band-calibration release-predictability skill skill-manifest ceiling ceiling-tracking tracking-extract tracking-eda tracking-players tracking-model tracking-study player-season-data player-season-eda player-season-model era-drift movement-compare leakage-demo test notebooks pipeline clean

setup:                ## install CPU deps (torch CPU first)
	$(PY) -m pip install torch --index-url https://download.pytorch.org/whl/cpu
	$(PY) -m pip install -r requirements.txt

data:                 ## acquire the configured tier into data/raw
	$(PY) -m src.data.acquire

validate-data:        ## validate every dataset + season coverage -> reports/DATA_VALIDATION.md
	$(PY) -m src.data.validate

tracking:             ## pull NBA-API player tracking summaries (Tier B, cached)
	$(PY) -m src.data.tracking

features:             ## clean, merge, engineer, split -> data/processed
	$(PY) -m src.features.build

baseline:             ## zone xP baseline metrics
	$(PY) -m src.models.baseline_xp

train:                ## train all classical + deep models, log to MLflow
	$(PY) -m src.models.train --model all

calibrate:            ## calibrate the best model
	$(PY) -m src.models.calibrate

evaluate:             ## single-use test-season evaluation
	$(PY) -m src.models.evaluate --test

explain:              ## SHAP global plots
	$(PY) -m src.models.explain

serve:                ## smoke-test the serve function
	$(PY) -m src.serve.predict

api:                  ## run the FastAPI inference + game API (localhost:8000)
	$(PY) -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

tune:                 ## Optuna hyperparameter search (CatBoost + LightGBM)
	$(PY) -m src.models.tune --model both

defender-study:       ## 2014-15 defender study (with/without contest)
	$(PY) -m src.studies.defender_2015

figures:              ## regenerate every thesis figure
	$(PY) scripts/make_thesis_figures.py

learning-curve:       ## does more data help? val AUC vs training size
	$(PY) -m src.models.learning_curve

ablation:             ## what is each feature group worth? (run with drop_groups: [])
	$(PY) -m src.models.ablation

ablate-tracking:      ## per-feature ablation of the 6 newly wired tracking measures
	$(PY) -m src.models.ablate_tracking

ab-skill:             ## A/B: empirical-Bayes player-skill shrinkage vs raw group means
	$(PY) -m src.models.ab_skill

ab-catboost-cats:     ## A/B: CatBoost native categoricals vs one-hot encoding
	$(PY) -m src.models.ab_catboost_cats

ab-opponent-zone:     ## A/B: zone-specific opponent defence (prior games only)
	$(PY) -m src.models.ab_opponent_zone

leaderboard-ci:       ## paired bootstrap CIs across the model leaderboard
	$(PY) -m src.models.leaderboard_ci

robustness:           ## slice calibration grid + drift + OOD probes -> reports/ROBUSTNESS.md
	$(PY) -m src.models.robustness

band-calibration:     ## per-support-band recalibration for the low-support defect
	$(PY) -m src.models.band_calibration

skill:                ## Brier Skill Score + Murphy decomposition + bootstrap CIs
	$(PY) -m src.models.skill_score

skill-manifest:       ## headline skill scores from the frozen bundle (no data needed)
	$(PY) -m src.models.skill_score --manifest

release-predictability: ## can the ball flight be predicted from pre-release data? (R^2)
	$(PY) -m src.models.release_predictability

ceiling:              ## irreducible AUC ceiling: why 0.80+ is impossible without leakage
	$(PY) -m src.models.ceiling

ceiling-tracking:     ## exact AUC_max under full tracking + how to legitimately exceed 0.80
	$(PY) -m src.models.ceiling_tracking

movement-extract:     ## SportVU -> waypoint sequences (heavy; ~1 min/game)
	$(PY) -m src.movement.extract

movement-compare:     ## Shot Delivery bake-off: baselines vs GRU/LSTM/Transformer (ADE/FDE)
	$(PY) -m src.movement.compare_movement

tracking-extract:     ## SportVU -> shot-level tracking features (all 636 games, ~20 min)
	$(PY) -m src.movement.extract_shots --games 0 --workers 5

tracking-eda:         ## EDA for the 2015-16 tracking model -> reports/TRACKING_EDA.md
	$(PY) -m src.movement.eda_tracking

tracking-players:     ## SportVU -> per-shot player SET for the Set-Transformer (~20 min)
	$(PY) -m src.movement.extract_players --games 0 --workers 5

tracking-model:       ## train Model 2: no-tracking vs boosting vs Set-Transformer, export
	$(PY) -m src.studies.tracking_model

player-season-data:   ## build the player-season efficiency dataset (Bref + tracking + profiles)
	$(PY) -m src.data.player_season

player-season-eda:    ## EDA for Model 3 -> reports/PLAYER_SEASON_EDA.md
	$(PY) -m src.data.eda_player_season

player-season-model:  ## train Model 3 (elite-efficiency): logreg/LGB/CatBoost/MLP, export
	$(PY) -m src.models.player_season_model

era-drift:            ## full 2014-2026 shot model with era-drift handling (recent vs naive vs handled)
	$(PY) -m src.models.era_drift

tracking-study:       ## what real tracking data is worth (2015-16, honest)
	$(PY) -m src.studies.tracking_2016

leakage-demo:         ## NEGATIVE CONTROL: how to fake AUC 0.90 and why it is worthless
	$(PY) -m src.studies.leakage_demo

movement-train:       ## cluster + GRU + ADE/FDE evaluation
	$(PY) -m src.movement.train_movement

export:               ## freeze versioned production bundle (models/production/vN)
	$(PY) -m src.models.export

test:                 ## run the test suite
	$(PY) -m pytest tests -q

notebooks:            ## (re)generate the thin notebooks
	$(PY) scripts/make_notebooks.py

pipeline: data tracking features baseline train calibrate evaluate explain serve  ## full run (tracking is cached + graceful)

clean:                ## remove processed data + models + mlruns
	rm -rf data/processed data/interim data/raw models mlruns reports/figures
