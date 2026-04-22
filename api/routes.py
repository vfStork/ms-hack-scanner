from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, Query, UploadFile, HTTPException
from pydantic import BaseModel

from pipeline.ingest import load_scan
from pipeline.clean import clean_mesh
from pipeline.diff import compute_diff, export_diff_glb
from pipeline.export import export_glb
from registry import store
from ai.enrich import enrich_twin
from ai.describe import describe_changes

router = APIRouter(prefix="/api")


# ── Request / Response models ────────────────────────────────────────

class CompareRequest(BaseModel):
    twin_id: str
    version_a: int
    version_b: int
    use_cleaned: bool = False


# ── Upload ───────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_scan(file: UploadFile = File(...), name: str = Form("Untitled")):
    """Upload a raw .ply/.obj scan → register twin (raw only)."""
    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".ply", ".obj", ".stl"}:
        raise HTTPException(400, f"Unsupported file format: {suffix}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        twin = store.register_twin(name=name, raw_ply_path=tmp_path)
    finally:
        os.unlink(tmp_path)

    return twin.to_dict()


# ── Rescan ───────────────────────────────────────────────────────────

@router.post("/twins/{twin_id}/rescan")
async def rescan(twin_id: str, file: UploadFile = File(...)):
    """Upload a new scan as the next version of an existing twin."""
    suffix = Path(file.filename).suffix.lower()

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        twin = store.add_version(twin_id=twin_id, raw_ply_path=tmp_path)
    finally:
        os.unlink(tmp_path)

    return twin.to_dict()


# ── Clean ────────────────────────────────────────────────────────────

@router.post("/twins/{twin_id}/versions/{version}/clean")
async def clean_version(twin_id: str, version: int):
    """Trigger noise-removal on a specific version (on demand)."""
    twin = store.get_twin(twin_id)
    v = next((v for v in twin.versions if v.version == version), None)
    if v is None:
        raise HTTPException(404, f"Version {version} not found")
    if v.is_cleaned:
        raise HTTPException(400, "Already cleaned")

    raw_mesh = load_scan(v.raw_ply)
    cleaned = clean_mesh(raw_mesh)
    twin = store.mark_cleaned(twin_id, version, cleaned)
    return twin.to_dict()


# ── Enrich ───────────────────────────────────────────────────────────

@router.post("/twins/{twin_id}/enrich")
async def enrich(twin_id: str):
    """Run AI enrichment on the latest version of the twin."""
    twin = store.get_twin(twin_id)
    latest = twin.latest_version()
    if latest is None:
        raise HTTPException(404, "No versions found")

    ply_path = latest.clean_ply if latest.is_cleaned else latest.raw_ply
    mesh = load_scan(ply_path)
    metadata = enrich_twin(mesh)
    twin = store.update_metadata(twin_id, metadata)
    return twin.to_dict()


# ── Compare ──────────────────────────────────────────────────────────

@router.post("/compare")
async def compare(req: CompareRequest):
    """Compare two versions of a twin. Returns diff stats + AI description."""
    twin = store.get_twin(req.twin_id)
    va = next((v for v in twin.versions if v.version == req.version_a), None)
    vb = next((v for v in twin.versions if v.version == req.version_b), None)
    if va is None or vb is None:
        raise HTTPException(404, "One or both versions not found")

    # Pick raw or cleaned mesh
    path_a = (va.clean_ply if req.use_cleaned and va.is_cleaned else va.raw_ply)
    path_b = (vb.clean_ply if req.use_cleaned and vb.is_cleaned else vb.raw_ply)

    mesh_a = load_scan(path_a)
    mesh_b = load_scan(path_b)

    diff_result = compute_diff(mesh_a, mesh_b)

    # Export heatmap GLB
    twin_dir = store._twin_dir(req.twin_id)
    heatmap_path = str(
        twin_dir / f"diff_v{req.version_a}_v{req.version_b}.glb"
    )
    export_diff_glb(mesh_a, diff_result.per_vertex_distances, heatmap_path)

    # AI description
    description = describe_changes(diff_result, twin.metadata)

    # Store in changelog
    twin = store.add_changelog(
        twin_id=req.twin_id,
        version_a=req.version_a,
        version_b=req.version_b,
        description=description,
        diff_stats=diff_result.to_dict(),
        heatmap_glb=heatmap_path,
    )

    return {
        "twin": twin.to_dict(),
        "diff": diff_result.to_dict(),
        "description": description,
        "heatmap_url": f"/api/twins/{req.twin_id}/comparisons/v{req.version_a}_v{req.version_b}/heatmap",
    }


# ── List / Detail ────────────────────────────────────────────────────

@router.get("/twins")
async def list_twins():
    return [t.to_dict() for t in store.list_twins()]


@router.get("/twins/{twin_id}")
async def get_twin(twin_id: str):
    try:
        return store.get_twin(twin_id).to_dict()
    except FileNotFoundError:
        raise HTTPException(404, "Twin not found")


# ── Serve model files ────────────────────────────────────────────────

@router.get("/twins/{twin_id}/versions/{version}/model")
async def get_model(twin_id: str, version: int, variant: str = Query("raw")):
    """Serve a .glb model file. variant = 'raw' | 'clean'."""
    from fastapi.responses import FileResponse

    twin = store.get_twin(twin_id)
    v = next((v for v in twin.versions if v.version == version), None)
    if v is None:
        raise HTTPException(404, "Version not found")

    if variant == "clean":
        if not v.is_cleaned or not v.clean_glb:
            raise HTTPException(404, "Cleaned model not available")
        glb_path = v.clean_glb
    else:
        glb_path = v.raw_glb

    if not Path(glb_path).exists():
        raise HTTPException(404, "GLB file not found on disk")

    return FileResponse(glb_path, media_type="model/gltf-binary")


@router.get("/twins/{twin_id}/comparisons/{cmp_id}/heatmap")
async def get_heatmap(twin_id: str, cmp_id: str):
    """Serve a diff heatmap GLB. cmp_id format: 'v1_v2'."""
    from fastapi.responses import FileResponse

    twin_dir = store._twin_dir(twin_id)
    glb_path = twin_dir / f"diff_{cmp_id}.glb"
    if not glb_path.exists():
        raise HTTPException(404, "Heatmap not found")

    return FileResponse(str(glb_path), media_type="model/gltf-binary")
