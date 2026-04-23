from __future__ import annotations

import numpy as np
import open3d as o3d
from dataclasses import dataclass, field

from pipeline.export import export_glb


@dataclass
class DiffResult:
    mean_distance: float = 0.0
    max_distance: float = 0.0
    std_distance: float = 0.0
    p90_distance: float = 0.0
    p95_distance: float = 0.0
    alignment_fitness: float = 0.0
    alignment_rmse: float = 0.0
    volume_a: float = 0.0
    volume_b: float = 0.0
    volume_delta: float = 0.0
    bbox_a: list[float] = field(default_factory=list)
    bbox_b: list[float] = field(default_factory=list)
    per_vertex_distances: list[float] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "mean_distance": round(self.mean_distance, 6),
            "max_distance": round(self.max_distance, 6),
            "std_distance": round(self.std_distance, 6),
            "p90_distance": round(self.p90_distance, 6),
            "p95_distance": round(self.p95_distance, 6),
            "alignment_fitness": round(self.alignment_fitness, 6),
            "alignment_rmse": round(self.alignment_rmse, 6),
            "volume_a": round(self.volume_a, 6),
            "volume_b": round(self.volume_b, 6),
            "volume_delta": round(self.volume_delta, 6),
            "bbox_a": [round(v, 4) for v in self.bbox_a],
            "bbox_b": [round(v, 4) for v in self.bbox_b],
        }


def compute_diff(
    mesh_a: o3d.geometry.TriangleMesh,
    mesh_b: o3d.geometry.TriangleMesh,
    icp_threshold: float = 0.05,
) -> DiffResult:
    """Align two meshes via ICP and compute per-vertex distances."""
    pcd_a = mesh_a.sample_points_uniformly(number_of_points=50_000)
    pcd_b = mesh_b.sample_points_uniformly(number_of_points=50_000)

    # ICP alignment: align B onto A
    reg = o3d.pipelines.registration.registration_icp(
        pcd_b,
        pcd_a,
        icp_threshold,
        np.eye(4),
        o3d.pipelines.registration.TransformationEstimationPointToPoint(),
    )
    pcd_b.transform(reg.transformation)
    mesh_b_aligned = o3d.geometry.TriangleMesh(mesh_b)
    mesh_b_aligned.transform(reg.transformation)

    # Compute distances from each point in A to nearest in B
    dists_a = np.asarray(pcd_a.compute_point_cloud_distance(pcd_b))
    dists_b = np.asarray(pcd_b.compute_point_cloud_distance(pcd_a))
    # Symmetric: average of both directions
    all_dists = np.concatenate([dists_a, dists_b])

    # Volume via convex hull (approximation)
    try:
        vol_a = mesh_a.get_volume() if mesh_a.is_watertight() else 0.0
    except Exception:
        vol_a = 0.0
    try:
        vol_b = mesh_b_aligned.get_volume() if mesh_b_aligned.is_watertight() else 0.0
    except Exception:
        vol_b = 0.0

    bbox_a = mesh_a.get_axis_aligned_bounding_box()
    bbox_b = mesh_b_aligned.get_axis_aligned_bounding_box()

    p90 = float(np.percentile(all_dists, 90))
    p95 = float(np.percentile(all_dists, 95))

    return DiffResult(
        mean_distance=float(np.mean(all_dists)),
        max_distance=float(np.max(all_dists)),
        std_distance=float(np.std(all_dists)),
        p90_distance=p90,
        p95_distance=p95,
        alignment_fitness=float(reg.fitness),
        alignment_rmse=float(reg.inlier_rmse),
        volume_a=vol_a,
        volume_b=vol_b,
        volume_delta=vol_b - vol_a,
        bbox_a=(bbox_a.max_bound - bbox_a.min_bound).tolist(),
        bbox_b=(bbox_b.max_bound - bbox_b.min_bound).tolist(),
        per_vertex_distances=dists_a.tolist(),
    )


def export_diff_glb(
    mesh: o3d.geometry.TriangleMesh,
    distances: list[float],
    output_path: str,
) -> tuple[str, o3d.geometry.TriangleMesh]:
    """Bake per-vertex distance heatmap into vertex colors and export GLB."""
    import matplotlib.cm as cm

    dists = np.array(distances)
    if dists.max() > 0:
        normalized = dists / dists.max()
    else:
        normalized = dists

    # Map 0→blue, 1→red using jet colormap
    colors_rgba = cm.jet(normalized)
    colors_rgb = colors_rgba[:, :3]

    # The mesh may have more vertices than distance samples;
    # sample to match or pad
    n_verts = len(np.asarray(mesh.vertices))
    if len(colors_rgb) < n_verts:
        colors_rgb = np.resize(colors_rgb, (n_verts, 3))

    colored_mesh = o3d.geometry.TriangleMesh(mesh)
    colored_mesh.vertex_colors = o3d.utility.Vector3dVector(colors_rgb[:n_verts])

    return export_glb(colored_mesh, output_path), colored_mesh
