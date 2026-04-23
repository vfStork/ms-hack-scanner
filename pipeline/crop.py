import numpy as np
import open3d as o3d

# Minimum number of triangles to keep after cropping; warn if below this.
MIN_TRIANGLES_WARN = 100


def crop_by_plane(
    mesh: o3d.geometry.TriangleMesh,
    point: tuple[float, float, float],
    normal: tuple[float, float, float],
) -> o3d.geometry.TriangleMesh:
    """Remove all geometry on the negative side of a plane.

    Keeps vertices where dot(v - point, normal) >= 0.

    Args:
        mesh:   Input triangle mesh.
        point:  Any point on the cutting plane (x, y, z).
        normal: Plane normal pointing toward the region to KEEP (nx, ny, nz).
    """
    n = np.array(normal, dtype=np.float64)
    norm = np.linalg.norm(n)
    if norm == 0:
        raise ValueError("Plane normal must be a non-zero vector.")
    n /= norm

    p = np.array(point, dtype=np.float64)
    vertices = np.asarray(mesh.vertices)

    # Vertices on the keep-side: dot(v - p, n) >= 0
    keep_mask = (vertices - p) @ n >= 0
    keep_indices = np.where(keep_mask)[0]

    return _select_vertices(mesh, keep_indices)


def crop_by_bbox(
    mesh: o3d.geometry.TriangleMesh,
    min_bound: tuple[float, float, float],
    max_bound: tuple[float, float, float],
) -> o3d.geometry.TriangleMesh:
    """Keep only geometry whose vertices fall inside an axis-aligned bounding box.

    Args:
        mesh:      Input triangle mesh.
        min_bound: (xmin, ymin, zmin) corner of the box.
        max_bound: (xmax, ymax, zmax) corner of the box.
    """
    aabb = o3d.geometry.AxisAlignedBoundingBox(
        min_bound=np.array(min_bound, dtype=np.float64),
        max_bound=np.array(max_bound, dtype=np.float64),
    )
    vertices = np.asarray(mesh.vertices)
    mn = np.array(min_bound, dtype=np.float64)
    mx = np.array(max_bound, dtype=np.float64)

    inside_mask = np.all((vertices >= mn) & (vertices <= mx), axis=1)
    keep_indices = np.where(inside_mask)[0]

    return _select_vertices(mesh, keep_indices)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _select_vertices(
    mesh: o3d.geometry.TriangleMesh,
    keep_indices: np.ndarray,
) -> o3d.geometry.TriangleMesh:
    """Return a new mesh containing only the given vertex indices.

    Triangles referencing any removed vertex are discarded.
    """
    if len(keep_indices) == 0:
        raise ValueError("Crop parameters removed all vertices — nothing left.")

    keep_set = set(keep_indices.tolist())
    triangles = np.asarray(mesh.triangles)

    # Keep triangles where every vertex is in the keep set
    tri_mask = np.array([
        t[0] in keep_set and t[1] in keep_set and t[2] in keep_set
        for t in triangles
    ])

    # Build index remapping: old index → new index
    old_to_new = {old: new for new, old in enumerate(keep_indices.tolist())}

    vertices = np.asarray(mesh.vertices)[keep_indices]
    new_tris = np.array([
        [old_to_new[t[0]], old_to_new[t[1]], old_to_new[t[2]]]
        for t in triangles[tri_mask]
    ], dtype=np.int32) if tri_mask.any() else np.empty((0, 3), dtype=np.int32)

    result = o3d.geometry.TriangleMesh()
    result.vertices = o3d.utility.Vector3dVector(vertices)
    result.triangles = o3d.utility.Vector3iVector(new_tris)

    # Carry over per-vertex colours if present
    if mesh.has_vertex_colors():
        colors = np.asarray(mesh.vertex_colors)[keep_indices]
        result.vertex_colors = o3d.utility.Vector3dVector(colors)

    # Ensure consistent outward-facing winding before computing normals
    result.orient_triangles()
    result.compute_vertex_normals()

    n_tris = len(new_tris)
    if n_tris < MIN_TRIANGLES_WARN:
        import warnings
        warnings.warn(
            f"Crop result has only {n_tris} triangle(s). "
            "Consider adjusting crop parameters.",
            UserWarning,
        )

    return result
