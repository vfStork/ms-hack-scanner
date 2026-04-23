import numpy as np
import open3d as o3d
import trimesh
from pathlib import Path


def _o3d_mesh_to_trimesh(mesh: o3d.geometry.TriangleMesh) -> trimesh.Trimesh:
    """Convert an Open3D TriangleMesh to a trimesh Trimesh."""
    vertices = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.triangles)

    kwargs = {}
    if mesh.has_vertex_colors():
        colors = (np.asarray(mesh.vertex_colors) * 255).astype(np.uint8)
        # Add alpha channel
        alpha = np.full((len(colors), 1), 255, dtype=np.uint8)
        kwargs["vertex_colors"] = np.hstack([colors, alpha])
    if mesh.has_vertex_normals():
        kwargs["vertex_normals"] = np.asarray(mesh.vertex_normals)

    return trimesh.Trimesh(vertices=vertices, faces=faces, **kwargs)


def export_glb(mesh: o3d.geometry.TriangleMesh, output_path: str) -> str:
    """Export an Open3D mesh to GLB format for Three.js viewing.

    Detects Z-up meshes (common in STL/scanner output) and rotates
    to Y-up (glTF convention) before export. The original mesh is
    not modified.
    """
    t_mesh = _o3d_mesh_to_trimesh(mesh)

    # Auto-correct Z-up → Y-up: rotate -90° around X when Z-extent > Y-extent
    bounds = t_mesh.bounds  # [[min_x,min_y,min_z],[max_x,max_y,max_z]]
    extents = bounds[1] - bounds[0]
    if extents[2] > extents[1]:
        rot = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
        t_mesh.apply_transform(rot)

    p = Path(output_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    t_mesh.export(str(p), file_type="glb")
    return str(p)


def export_ply(mesh: o3d.geometry.TriangleMesh, output_path: str) -> str:
    """Export an Open3D mesh to PLY format for archival."""
    p = Path(output_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    o3d.io.write_triangle_mesh(str(p), mesh)
    return str(p)
