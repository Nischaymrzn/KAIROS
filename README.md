# KAIROS

KAIROS (Predictive Model for Basketball Shot Accuracy Using Statistical Inference and Machine
Learning Techniques on Publicly Available NBA Data) estimates how likely an individual basketball
shot is to go in, judged from the situation in which it was taken, and shows which parts of that
situation moved the estimate.

The name comes from the Greek word *kairos* (καιρός), meaning the right moment to act. That is
what the system measures. Not whether a shot went in, but whether it was worth taking.

## Overview

Field goal percentage counts every attempt the same way. A contested step back three with two
seconds on the shot clock and an open corner catch and shoot both enter the box score as one
attempt. The number records the outcome and says nothing about how hard the shot was.

KAIROS returns a calibrated probability for any shot scenario, an explanation ranking the
features behind it, and a clear statement of what the model cannot observe. Everything is
delivered through an interactive 3D court, where a user places a shooter and defenders, chooses
the shot type and game situation, and reads the result as it changes.

## Features

| Feature | What it does |
|---|---|
| Shot quality engine | Returns a calibrated make probability for any scenario |
| Explanation layer | Ranks the features behind every individual prediction |
| Interactive 3D court | Place a shooter and defenders, take the shot, watch the arc |
| Four modes | Court, Predict, Coach and Learn, each a separate screen |
| Control provenance | Every control declares whether the model actually reads it |
| Movement replay | Real tracked possessions replayed with all ten players |
| Analysis panels | Heat map, defence, arc lab, playbook, comparison and registry |
| Expected points | Compares the options available from one spot on the floor |

## Architecture

The system is five layers with two side branches, and each layer depends only on the one above
it. Acquisition and cleaning sit in the data package, feature construction in the feature
package, comparison and calibration in the model package, request handling in the serving
package with a set of routes above it, and two browser clients on top.

The separation is strict enough that the model is unaware of which interface is speaking for it,
so both clients call one scoring path and cannot diverge in what they report.

**Data.** Acquires, cleans, merges and splits five public sources into one validated table.
Cleaning normalises coordinates and action vocabularies across seasons that describe them
differently. Merging is the step that carries the risk, because two corpora joined without
checking produce a change of source that reads as a change in the sport, so every merge is gated
on an agreement check rather than performed on trust. Each column is stamped with the coverage
it actually has.

**Features.** Turns that table into numeric and categorical columns across nine groups covering
spatial position, shot and action type, game state, possession context, in game rhythm, rest and
scheduling, player profile, era context and contest. Columns that may be imputed are paired with
an indicator recording whether the value was measured, so missingness is flagged rather than
quietly filled. A group enters the frame only under a rule fixed before the test ran.

**Models.** Trains, compares, calibrates and audits. Every candidate runs under identical
columns, identical splits and identical calibration, with paired bootstrap intervals computed on
the same resampled indices so the comparison is like for like. Alongside training sit the
ablation harness, the recalibration attempt that failed, and a robustness grid that scores the
frozen artefact across slices and flags any whose calibration gap excludes zero.

**Serving.** Loads one frozen versioned bundle at startup and holds it for the process lifetime,
so two predictions made a second apart cannot come from different artefacts. The bundle carries
the fitted estimator, the calibrator, the feature list in training order, the categorical level
maps and a manifest identifying it. Typed routes sit above it, including a registry endpoint
reporting which artefact is loaded.

**Interfaces.** Two browser clients, an analysis dashboard and a three dimensional scenario
builder, and neither holds any modelling logic. Both operate on a single scenario object from
which distance, zone, contest geometry and expected points are derived rather than stored, which
removes the class of defect where two parts of an interface disagree about the situation being
described.

The side branches are the movement package, which extracts and compares pose sequences from one
season of tracking, and the studies package, which holds the controls that were built to be
measured rather than served.

## Tech Stack

**Machine learning** Python, Pandas, NumPy, CatBoost, XGBoost, LightGBM, PyTorch, SHAP, MLflow,
Optuna

**Backend** FastAPI, Uvicorn, Pydantic, SQLModel

**Frontend** React, TypeScript, Three.js, React Three Fiber, Zustand, Vite

**Tooling** Git, Pytest, Docker, Parquet, SQLite

## Getting Started

### Prerequisites

Python 3.11 is the target and 3.10 works. Node.js 18 or later for the client. Everything runs on
a single laptop and no GPU is required.

### Installation

```bash
git clone https://github.com/Nischaymrzn/KAIROS.git
cd KAIROS
make setup
```

### Running

Build the pipeline and start the API.

```bash
make pipeline
make api
```

Then start the client in a second terminal.

```bash
cd client
npm install
npm run dev
```

The API serves on `http://localhost:8000` with interactive documentation at `/docs`, and the
client on `http://localhost:5173`.

Individual stages have their own targets, among them `make features`, `make train`,
`make calibrate`, `make evaluate`, `make explain`, `make robustness` and `make ceiling`. Run
`make` with no arguments to list them all.

## Project Structure

```
src/                    the importable Python package
  data/                   loaders, cleaning, merging, contest recovery
  features/               feature engineering, nine groups
  models/                 train, calibrate, evaluate, ablate, audit, export
  movement/               tracking extraction and sequence models
  serve/                  the single scoring path
  studies/                controls built to be measured, not served
  inference/              prediction service logic

backend/                FastAPI inference service
  api/                    typed routes
  core/                   config, startup lifespan, error shape
  services/               game and session logic
  schemas/                request and response contracts
  db/                     session store

client/                 React and Three.js 3D court
  src/physics/            ballistics, arc solver, contest geometry
  src/player/             rig, skinning, animation
  src/scene/              court, shot arc, tracked replay
  src/workspace/          modes, panels, scene layers
  src/state/              scenario and playback stores
  src/api/                typed client

models/                 serialised bundles
  production/vN/          the frozen versioned artefact that serving loads

data/                   raw, interim, processed, external
notebooks/              exploration and analysis
scripts/                one off data collection
tests/                  pipeline, leakage and split tests
experiments/            MLflow runs and metrics
reports/                generated figures and analysis output
```

Code lives in `src/` and `scripts/`. Everything under `data/` can be fetched again and none of it
is committed.

## Results

Measured on a held out season of 219,157 attempts, read once after every development decision had
been settled.

| Measure | KAIROS | Zone average baseline |
|---|---|---|
| AUC | **0.7009** | 0.6369 |
| Brier score | **0.2134** | 0.2327 |
| Accuracy | **0.6504** | 0.6261 |
| Expected calibration error | **0.0080** | 0.0186 |
| Brier Skill Score | **0.1434** | 0.0660 |

The improvement in AUC is **+0.0640**, with a 95 per cent paired bootstrap interval of
**[0.0622, 0.0656]**, so it is statistically unambiguous.

That improvement also has a measured limit, which the project locates rather than assumes.
Roughly 86 per cent of the uncertainty in a base rate forecast survives, because most of what
decides a shot is settled after the ball leaves the hand.

## Limitations

The system produces no player rankings and is not a basis for decisions about selection, minutes
or contracts. It is advisory, and the final judgement rests with coaches and players.

Calibration holds across almost every slice examined and fails on one. Players with very little
recorded history are rated below what they actually shoot. A recalibration was built as a remedy
and rejected because it moved the defect rather than removing it, so the failure is reported
openly rather than absorbed into an average.

No coach, analyst or player has used the system. Every claim about what the interface
communicates is an argument from design, not a finding from observation.

## Author

**Nischay Maharjan**
Student ID 230357, Coventry ID 14811265
Supervisor: Manoj Shrestha

ST6001CEM Individual Project
Softwarica College of IT and E Commerce, in academic partnership with Coventry University

Thesis title: *Design, Implementation, and Assessment of a Predictive Model for Basketball Shot
Accuracy Using Statistical Inference and Machine Learning Techniques on Publicly Available NBA
Data.*

## Licence

Built for academic assessment. Every source is public and the pipeline reruns from a documented
command, which is the point, because a result nobody outside the project can check is an
assertion rather than a finding.
