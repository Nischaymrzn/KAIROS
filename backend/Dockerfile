# HoopIQ inference + game API — CPU image (serving needs no GPU).
# Build from the repo root:  docker build -f backend/Dockerfile -t hoopiq-api .
# Run:                        docker run -p 8000:8000 hoopiq-api
FROM python:3.10-slim

WORKDIR /app

# CPU torch first (much smaller than the CUDA wheel), then the rest.
COPY requirements.txt ./
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# Source + the frozen production models (models/production/latest.json).
COPY src ./src
COPY backend ./backend
COPY config.yaml ./
COPY models ./models
COPY data/processed/feature_meta.json ./data/processed/feature_meta.json

# the game store (SQLite) is created here at startup
RUN mkdir -p data

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
