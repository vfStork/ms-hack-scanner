# syntax=docker/dockerfile:1.7
FROM python:3.11-slim-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System deps for Open3D headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -r requirements.txt

COPY main.py ./
COPY ai ./ai
COPY api ./api
COPY pipeline ./pipeline
COPY registry ./registry
COPY web ./web

EXPOSE 80

CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "80"]
