import open3d as o3d
from pathlib import Path

SUPPORTED_EXTENSIONS = {".ply", ".obj", ".stl"}


def load_scan(path: str) -> o3d.geometry.TriangleMesh:
    """Load a mesh file from disk, validate it, and compute normals."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Scan file not found: {path}")
    if p.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported format '{p.suffix}'. Use: {SUPPORTED_EXTENSIONS}"
        )

    mesh = o3d.io.read_triangle_mesh(str(p))

    if not mesh.has_vertices():
        raise ValueError(f"Mesh has no vertices: {path}")

    mesh.compute_vertex_normals()
    return mesh
