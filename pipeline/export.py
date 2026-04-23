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

    # process=False preserves the vertex order so vertex_colors stays aligned.
    # trimesh's default process=True merges/reorders vertices which silently
    # drops or misaligns color data, causing the model to render black.
    t_mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False, **kwargs)

    # Set a non-metallic PBR material. Without this, trimesh writes no material
    # and GLB viewers apply the GLTF default (metallicFactor=1.0), which renders
    # pitch-black under standard lighting with no environment map.
    # Assigning the material AFTER construction keeps COLOR_0 intact.
    t_mesh.visual.material = trimesh.visual.material.PBRMaterial(
        metallicFactor=0.0,
        roughnessFactor=0.8,
    )

    return t_mesh


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
