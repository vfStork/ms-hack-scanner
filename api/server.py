from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from api.routes import router

app = FastAPI(title="Digital Twin Scanner", version="0.1.0")

app.include_router(router)

# Serve frontend static files (web/)
web_dir = Path(__file__).resolve().parent.parent / "web"
if web_dir.exists():
    app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")
