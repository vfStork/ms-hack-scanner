import numpy as np
import open3d as o3d

# Default cleaning parameters — configurable per call
DEFAULT_NB_NEIGHBORS = 20
DEFAULT_STD_RATIO = 2.0
DEFAULT_POISSON_DEPTH = 9
DEFAULT_SAMPLE_POINTS = 100_000
# Remove bottom 1% density vertices (boundary artifacts from Poisson)
DEFAULT_DENSITY_QUANTILE = 0.01


def clean_mesh(
    mesh: o3d.geometry.TriangleMesh,
    *,
    nb_neighbors: int = DEFAULT_NB_NEIGHBORS,
    std_ratio: float = DEFAULT_STD_RATIO,
    depth: int = DEFAULT_POISSON_DEPTH,
    sample_points: int = DEFAULT_SAMPLE_POINTS,
    density_quantile: float = DEFAULT_DENSITY_QUANTILE,
) -> o3d.geometry.TriangleMesh:
    """Remove noise and reconstruct a clean surface from a raw scan mesh."""
    # 1. Ensure mesh normals exist before sampling (needed for Poisson)
    if not mesh.has_vertex_normals():
        mesh.compute_vertex_normals()

    # 2. Convert to point cloud for statistical outlier removal
    pcd = mesh.sample_points_uniformly(number_of_points=sample_points)
    pcd_clean, _ = pcd.remove_statistical_outlier(
        nb_neighbors=nb_neighbors, std_ratio=std_ratio
    )

    # 3. Ensure the cleaned point cloud has normals for Poisson
    if not pcd_clean.has_normals():
        pcd_clean.estimate_normals()
    pcd_clean.orient_normals_consistent_tangent_plane(k=100)

    # 4. Reconstruct surface via Poisson (fills holes)
    mesh_clean, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd_clean, depth=depth
    )

    # Remove low-density vertices at the boundary (Poisson artifact)
    density_threshold = np.quantile(np.asarray(densities), density_quantile)
    vertices_to_remove = np.asarray(densities) < density_threshold
    mesh_clean.remove_vertices_by_mask(vertices_to_remove)

    # 5. Transfer vertex colors from the cleaned point cloud back to the
    #    reconstructed mesh. Poisson creates new vertices with no colors, so
    #    we map each new vertex to its nearest neighbor in the source cloud.
    if pcd_clean.has_colors():
        kd_tree = o3d.geometry.KDTreeFlann(pcd_clean)
        source_colors = np.asarray(pcd_clean.colors)
        mesh_colors = []
        for vertex in np.asarray(mesh_clean.vertices):
            _, idx, _ = kd_tree.search_knn_vector_3d(vertex, 1)
            mesh_colors.append(source_colors[idx[0]])
        mesh_clean.vertex_colors = o3d.utility.Vector3dVector(
            np.array(mesh_colors)
        )

    # 6. Remove degenerate geometry
    mesh_clean = mesh_clean.remove_degenerate_triangles()
    mesh_clean = mesh_clean.remove_duplicated_vertices()
    mesh_clean.compute_vertex_normals()

    return mesh_clean
