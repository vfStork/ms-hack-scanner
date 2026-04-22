import open3d as o3d

# Load raw scan
mesh = o3d.io.read_triangle_mesh("scan_raw.ply")
mesh.compute_vertex_normals()

# 1. Convert to point cloud for noise removal
pcd = mesh.sample_points_uniformly(number_of_points=100_000)
pcd_clean, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)

# 2. Reconstruct surface (Poisson removes holes)
mesh_clean, _ = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
    pcd_clean, depth=9
)

# 3. Remove low-density fragments
mesh_clean = mesh_clean.remove_degenerate_triangles()
mesh_clean = mesh_clean.remove_duplicated_vertices()