from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from registry.models import Twin, TwinVersion, ChangeEntry
from pipeline.export import export_glb, export_ply
from pipeline.ingest import load_scan

TWINS_DIR = Path("twins")


def _twin_dir(twin_id: str) -> Path:
    return TWINS_DIR / twin_id


def _meta_path(twin_id: str) -> Path:
    return _twin_dir(twin_id) / "meta.json"


def _save(twin: Twin) -> None:
    path = _meta_path(twin.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(twin.to_dict(), indent=2))


def _load(twin_id: str) -> Twin:
    path = _meta_path(twin_id)
    if not path.exists():
        raise FileNotFoundError(f"Twin not found: {twin_id}")
    return Twin.from_dict(json.loads(path.read_text()))


def register_twin(name: str, raw_ply_path: str) -> Twin:
    """Create a new twin from a raw scan. Stores raw mesh + .glb."""
    twin_id = str(uuid.uuid4())
    d = _twin_dir(twin_id)
    d.mkdir(parents=True, exist_ok=True)

    # Copy raw mesh, preserving original extension
    ext = Path(raw_ply_path).suffix or ".ply"
    dest_ply = str(d / f"v1_raw{ext}")
    shutil.copy2(raw_ply_path, dest_ply)

    # Export raw GLB for viewer
    mesh = load_scan(dest_ply)
    dest_glb = str(d / "v1_raw.glb")
    export_glb(mesh, dest_glb)

    now = datetime.now(timezone.utc).isoformat()
    version = TwinVersion(
        version=1,
        uploaded_at=now,
        raw_ply=dest_ply,
        raw_glb=dest_glb,
    )
    twin = Twin(id=twin_id, name=name, created=now, versions=[version])
    _save(twin)
    return twin


def add_version(twin_id: str, raw_ply_path: str) -> Twin:
    """Add a new scan version (raw only) to an existing twin."""
    twin = _load(twin_id)
    v_num = len(twin.versions) + 1
    d = _twin_dir(twin_id)

    ext = Path(raw_ply_path).suffix or ".ply"
    dest_ply = str(d / f"v{v_num}_raw{ext}")
    shutil.copy2(raw_ply_path, dest_ply)

    mesh = load_scan(dest_ply)
    dest_glb = str(d / f"v{v_num}_raw.glb")
    export_glb(mesh, dest_glb)

    now = datetime.now(timezone.utc).isoformat()
    version = TwinVersion(
        version=v_num,
        uploaded_at=now,
        raw_ply=dest_ply,
        raw_glb=dest_glb,
    )
    twin.versions.append(version)
    _save(twin)
    return twin


def mark_cleaned(
    twin_id: str, version_num: int, cleaned_mesh
) -> Twin:
    """Store a cleaned mesh for a specific version."""
    twin = _load(twin_id)
    v = next((v for v in twin.versions if v.version == version_num), None)
    if v is None:
        raise ValueError(f"Version {version_num} not found for twin {twin_id}")

    d = _twin_dir(twin_id)
    v.clean_ply = str(d / f"v{version_num}_clean.ply")
    v.clean_glb = str(d / f"v{version_num}_clean.glb")
    v.is_cleaned = True

    export_ply(cleaned_mesh, v.clean_ply)
    export_glb(cleaned_mesh, v.clean_glb)

    _save(twin)
    return twin


def mark_cropped(
    twin_id: str, version_num: int, cropped_mesh
) -> Twin:
    """Store a cropped mesh for a specific version."""
    twin = _load(twin_id)
    v = next((v for v in twin.versions if v.version == version_num), None)
    if v is None:
        raise ValueError(f"Version {version_num} not found for twin {twin_id}")

    d = _twin_dir(twin_id)
    v.cropped_ply = str(d / f"v{version_num}_cropped.ply")
    v.cropped_glb = str(d / f"v{version_num}_cropped.glb")
    v.is_cropped = True

    export_ply(cropped_mesh, v.cropped_ply)
    export_glb(cropped_mesh, v.cropped_glb)

    _save(twin)
    return twin


def add_changelog(
    twin_id: str,
    version_a: int,
    version_b: int,
    description: str,
    diff_stats: dict,
    heatmap_glb: Optional[str] = None,
) -> Twin:
    """Append a comparison entry to the twin's changelog."""
    twin = _load(twin_id)
    entry = ChangeEntry(
        timestamp=datetime.now(timezone.utc).isoformat(),
        version_a=version_a,
        version_b=version_b,
        description=description,
        diff_stats=diff_stats,
        heatmap_glb=heatmap_glb,
    )
    twin.changelog.append(entry)
    _save(twin)
    return twin


def update_metadata(twin_id: str, metadata: dict) -> Twin:
    """Merge new metadata into the twin's metadata dict."""
    twin = _load(twin_id)
    twin.metadata.update(metadata)
    _save(twin)
    return twin


def _validated_twin_dir_for_delete(twin_id: str) -> Path:
    """Return a twin directory path that is safe to delete."""
    try:
        uuid.UUID(twin_id)
    except ValueError as exc:
        raise ValueError(f"Invalid twin_id format: {twin_id}") from exc

    twins_root = TWINS_DIR.resolve()
    twin_dir = (twins_root / twin_id).resolve()

    try:
        twin_dir.relative_to(twins_root)
    except ValueError as exc:
        raise ValueError(
            f"Refusing to delete path outside twins directory: {twin_id}"
        ) from exc

    return twin_dir


def delete_twin(twin_id: str) -> None:
    """Delete a twin and all its associated files from disk."""
    _load(twin_id)  # raises FileNotFoundError if missing
    twin_dir = _validated_twin_dir_for_delete(twin_id)
    shutil.rmtree(twin_dir)


def get_twin(twin_id: str) -> Twin:
    return _load(twin_id)


def list_twins() -> list[Twin]:
    if not TWINS_DIR.exists():
        return []
    twins = []
    for d in sorted(TWINS_DIR.iterdir()):
        meta = d / "meta.json"
        if meta.exists():
            twins.append(Twin.from_dict(json.loads(meta.read_text())))
    return twins
