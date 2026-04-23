import numpy as np
import open3d as o3d
from pathlib import Path

SUPPORTED_EXTENSIONS = {".ply", ".obj", ".stl"}


def _bake_texture_to_vertex_colors(mesh: o3d.geometry.TriangleMesh) -> o3d.geometry.TriangleMesh:
    """Sample the first texture at each UV coordinate and store as vertex_colors.

    Called when a mesh has UV textures but no per-vertex colors (common in OBJ
    photogrammetry exports). Vertices shared across triangles are averaged so
    seams are handled gracefully.
    """
    if not mesh.has_triangle_uvs() or not mesh.has_textures():
        return mesh

    texture = np.asarray(mesh.textures[0])          # (H, W, C)
    h, w = texture.shape[:2]
    uvs = np.asarray(mesh.triangle_uvs)             # (n_tris * 3, 2)
    triangles = np.asarray(mesh.triangles)          # (n_tris, 3)
    n_verts = len(mesh.vertices)

    # Map each UV sample to a pixel coordinate (flip V: OpenGL → image space)
    px = np.clip((uvs[:, 0] * (w - 1)).astype(int), 0, w - 1)
    py = np.clip(((1.0 - uvs[:, 1]) * (h - 1)).astype(int), 0, h - 1)
    sampled = texture[py, px, :3].astype(np.float64)  # (n_tris*3, 3)

    # Accumulate and average over all triangles that touch each vertex
    vert_indices = triangles.ravel()                # (n_tris*3,)
    color_sum = np.zeros((n_verts, 3), dtype=np.float64)
    np.add.at(color_sum, vert_indices, sampled)
    count = np.zeros(n_verts, dtype=np.int32)
    np.add.at(count, vert_indices, 1)

    mask = count > 0
    color_sum[mask] /= count[mask, np.newaxis]
    color_sum /= 255.0                              # normalize to [0, 1]

    mesh.vertex_colors = o3d.utility.Vector3dVector(color_sum)
    return mesh


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

    # If the scan uses UV textures instead of per-vertex colors (common in OBJ
    # photogrammetry exports), bake the texture into vertex colors so the rest
    # of the pipeline (clean, crop, export) can work with them uniformly.
    if not mesh.has_vertex_colors() and mesh.has_textures():
        mesh = _bake_texture_to_vertex_colors(mesh)

    mesh.compute_vertex_normals()
    return mesh
