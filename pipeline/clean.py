import open3d as o3d

# Default cleaning parameters — configurable per call
DEFAULT_NB_NEIGHBORS = 20
DEFAULT_STD_RATIO = 2.0
DEFAULT_POISSON_DEPTH = 9
DEFAULT_SAMPLE_POINTS = 100_000


def clean_mesh(
    mesh: o3d.geometry.TriangleMesh,
    *,
    nb_neighbors: int = DEFAULT_NB_NEIGHBORS,
    std_ratio: float = DEFAULT_STD_RATIO,
    depth: int = DEFAULT_POISSON_DEPTH,
    sample_points: int = DEFAULT_SAMPLE_POINTS,
) -> o3d.geometry.TriangleMesh:
    """Remove noise and reconstruct a clean surface from a raw scan mesh."""
    # 1. Convert to point cloud for statistical outlier removal
    pcd = mesh.sample_points_uniformly(number_of_points=sample_points)
    pcd_clean, _ = pcd.remove_statistical_outlier(
        nb_neighbors=nb_neighbors, std_ratio=std_ratio
    )

    # 2. Reconstruct surface via Poisson (fills holes)
    mesh_clean, _ = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd_clean, depth=depth
    )

    # 3. Remove degenerate geometry
    mesh_clean = mesh_clean.remove_degenerate_triangles()
    mesh_clean = mesh_clean.remove_duplicated_vertices()
    mesh_clean.compute_vertex_normals()

    return mesh_clean
