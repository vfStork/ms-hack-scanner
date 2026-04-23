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

### Cropping a mesh

Remove parts of a mesh using a **cutting plane** or an **axis-aligned bounding box**.
The cropped result is saved alongside the original (non-destructive).

```bash
# Keep everything on the positive side of a plane at z = 0.5 (normal pointing +z)
python main.py crop <twin-id> --mode plane --point 0,0,0.5 --normal 0,0,1

# Trim to a bounding box
python main.py crop <twin-id> --mode bbox --min-bound -1,-1,0 --max-bound 1,1,2

# Crop a specific version (default: latest)
python main.py crop <twin-id> --version 2 --mode plane --point 0,0,0 --normal 0,1,0
```

The crop operates on the **cleaned** mesh when available, otherwise the raw mesh.
Re-running `crop` on the same version overwrites the previous cropped result.

## Deploy to Azure

```bash
az containerapp up --name ms-hack --source . --resource-group <rg> --environment <env>
```

## Project Structure

```
pipeline/       Ingest, clean, diff, export, crop (Open3D + trimesh)
ai/             Azure OpenAI enrichment + change description
registry/       Twin data model + JSON file store
api/            FastAPI server + REST routes
web/            Vanilla HTML + Three.js viewer (no build step)
twins/          Data directory (git-ignored)
```

## REST API — Crop endpoint

```
POST /api/twins/{twin_id}/versions/{version}/crop
```

**Plane cut** — keep geometry on the positive side of the plane:
```json
{
  "mode": "plane",
  "point": [0, 0, 0.5],
  "normal": [0, 0, 1]
}
```

**Bounding box crop** — keep geometry inside the box:
```json
{
  "mode": "bbox",
  "min_bound": [-1, -1, 0],
  "max_bound": [1, 1, 2]
}
```

The cropped `.ply` / `.glb` is served at:
```
GET /api/twins/{twin_id}/versions/{version}/model?variant=cropped
```
