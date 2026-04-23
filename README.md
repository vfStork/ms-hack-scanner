# Digital Twin Scanner

Scan a physical object → upload the mesh → clean on demand → AI-enrich → compare versions → see what changed.

## Architecture

```
Creality Raptor → .ply → [upload] → store raw → view in Three.js
                             │
                 user: "Clean" → outlier removal + Poisson → store cleaned
                             │
                 user: "Enrich" → Azure OpenAI → material, class, lifespan
                             │
Re-scan → .ply → [upload v2] → user: "Compare" → ICP diff + heatmap + AI description
```

## Setup

### WSL / Ubuntu

```bash
sudo apt update && sudo apt install python3.11 python3.11-venv libgomp1
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in your Azure OpenAI credentials
```

### Windows / macOS

```bash
python -m venv .venv
source .venv/bin/activate   # on Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # fill in your Azure OpenAI credentials
```

## Run (Web)

```bash
source .venv/bin/activate   # activate venv first
python main.py serve
# Open http://localhost:8000
```

## Run (CLI)

```bash
source .venv/bin/activate   # activate venv first
python main.py upload scan.ply --name "Valve A"
python main.py clean <twin-id>
python main.py enrich <twin-id>
python main.py rescan <twin-id> scan_v2.ply
python main.py compare <twin-id> 1 2
python main.py list
python main.py show <twin-id>
```

## Deploy to Azure

```bash
az containerapp up --name ms-hack --source . --resource-group <rg> --environment <env>
```

## Project Structure

```
pipeline/       Ingest, clean, diff, export (Open3D + trimesh)
ai/             Azure OpenAI enrichment + change description
registry/       Twin data model + JSON file store
api/            FastAPI server + REST routes
web/            Vanilla HTML + Three.js viewer (no build step)
twins/          Data directory (git-ignored)
```
