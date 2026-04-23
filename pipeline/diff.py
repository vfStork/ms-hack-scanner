from __future__ import annotations

import logging
import numpy as np
import open3d as o3d
from dataclasses import dataclass, field

from pipeline.export import export_glb

logger = logging.getLogger(__name__)

# ── Processing constants ─────────────────────────────────────────────
# ICP_THRESHOLD_FRACTION: max correspondence distance for ICP, expressed as
# a fraction of the bounding-box diagonal. This makes alignment work
# regardless of whether the mesh is in mm, cm, or m.
# 0.002 ≈ 0.7mm for a 350mm-diagonal scan — tolerates typical scanner noise.
ICP_THRESHOLD_FRACTION = 0.002

# DEFAULT_SAMPLE_COUNT: upper bound for uniform point sampling used in
# aggregate Hausdorff-like stats. Actual count is capped at mesh vertex count.
DEFAULT_SAMPLE_COUNT = 50_000

# ICP_FITNESS_WARNING_THRESHOLD: if ICP fitness falls below this, a warning
# is logged. Low fitness means few correspondences — alignment may be poor.
ICP_FITNESS_WARNING_THRESHOLD = 0.3

# HEATMAP_PERCENTILE_CLAMP: distances above this percentile are clamped
# before normalizing, so outliers don't wash out the color range.
HEATMAP_PERCENTILE_CLAMP = 95

# FPFH radii are derived from the bounding-box diagonal at runtime.
# FPFH_NORMAL_FRACTION: normal-estimation radius ≈ 1% of diagonal.
FPFH_NORMAL_FRACTION = 0.01
# FPFH_FEATURE_FRACTION: feature radius ≈ 2.5% of diagonal.
FPFH_FEATURE_FRACTION = 0.025


@dataclass
class DiffResult:
    mean_distance: float = 0.0
    max_distance: float = 0.0
    std_distance: float = 0.0
    volume_a: float = 0.0
    volume_b: float = 0.0
    volume_delta: float = 0.0
    bbox_a: list[float] = field(default_factory=list)
    bbox_b: list[float] = field(default_factory=list)
    per_vertex_distances: list[float] = field(default_factory=list)
    icp_fitness: float = 0.0
    icp_rmse: float = 0.0

    def to_dict(self) -> dict:
        return {
            "mean_distance": round(self.mean_distance, 6),
            "max_distance": round(self.max_distance, 6),
            "std_distance": round(self.std_distance, 6),
            "volume_a": round(self.volume_a, 6),
            "volume_b": round(self.volume_b, 6),
            "volume_delta": round(self.volume_delta, 6),
            "bbox_a": [round(v, 4) for v in self.bbox_a],
            "bbox_b": [round(v, 4) for v in self.bbox_b],
            "icp_fitness": round(self.icp_fitness, 6),
            "icp_rmse": round(self.icp_rmse, 6),
        }


def _bbox_diagonal(pcd: o3d.geometry.PointCloud) -> float:
    """Return the bounding-box diagonal length of a point cloud."""
    bbox = pcd.get_axis_aligned_bounding_box()
    return float(np.linalg.norm(bbox.max_bound - bbox.min_bound))


def _compute_fpfh(
    pcd: o3d.geometry.PointCloud,
    normal_radius: float,
    feature_radius: float,
) -> o3d.pipelines.registration.Feature:
    """Estimate normals and compute FPFH features for global registration."""
    pcd.estimate_normals(
        o3d.geometry.KDTreeSearchParamHybrid(radius=normal_radius, max_nn=30)
    )
    return o3d.pipelines.registration.compute_fpfh_feature(
        pcd,
        o3d.geometry.KDTreeSearchParamHybrid(radius=feature_radius, max_nn=100),
    )


def _coarse_registration(
    pcd_source: o3d.geometry.PointCloud,
    pcd_target: o3d.geometry.PointCloud,
    icp_threshold: float,
    diag: float,
) -> np.ndarray:
    """Run FPFH + RANSAC global registration and return the coarse transform."""
    normal_radius = diag * FPFH_NORMAL_FRACTION
    feature_radius = diag * FPFH_FEATURE_FRACTION
    ransac_dist = icp_threshold * 3
    logger.info(
        "FPFH params: normal_r=%.4f, feature_r=%.4f, ransac_dist=%.4f (diag=%.2f)",
        normal_radius, feature_radius, ransac_dist, diag,
    )

    feat_source = _compute_fpfh(pcd_source, normal_radius, feature_radius)
    feat_target = _compute_fpfh(pcd_target, normal_radius, feature_radius)

    result = o3d.pipelines.registration.registration_ransac_based_on_feature_matching(
        pcd_source,
        pcd_target,
        feat_source,
        feat_target,
        mutual_filter=True,
        max_correspondence_distance=ransac_dist,
        estimation_method=o3d.pipelines.registration.TransformationEstimationPointToPoint(),
        ransac_n=3,
        checkers=[
            o3d.pipelines.registration.CorrespondenceCheckerBasedOnDistance(ransac_dist),
        ],
        criteria=o3d.pipelines.registration.RANSACConvergenceCriteria(100_000, 0.999),
    )
    logger.info("Coarse registration fitness=%.4f, RMSE=%.6f", result.fitness, result.inlier_rmse)
    return result.transformation


def compute_diff(
    mesh_a: o3d.geometry.TriangleMesh,
    mesh_b: o3d.geometry.TriangleMesh,
    icp_threshold: float | None = None,
) -> DiffResult:
    """Align two meshes via ICP (identity-first, FPFH fallback) and compute distances."""

    # ── Deterministic point clouds from mesh vertices for ICP ────────
    # Using actual vertices (voxel-downsampled) instead of random uniform
    # samples ensures identical meshes produce identical point clouds
    # and ICP converges to identity.
    pcd_a_full = o3d.geometry.PointCloud()
    pcd_a_full.points = o3d.utility.Vector3dVector(np.asarray(mesh_a.vertices))
    pcd_b_full = o3d.geometry.PointCloud()
    pcd_b_full.points = o3d.utility.Vector3dVector(np.asarray(mesh_b.vertices))

    diag = _bbox_diagonal(pcd_a_full)
    if icp_threshold is None:
        icp_threshold = diag * ICP_THRESHOLD_FRACTION
    voxel_size = diag * 0.005  # ~1.7mm for a 350mm scan — fast ICP
    logger.info("Scale: bbox diagonal=%.2f, icp_threshold=%.4f, voxel=%.4f", diag, icp_threshold, voxel_size)

    pcd_a_ds = pcd_a_full.voxel_down_sample(voxel_size)
    pcd_b_ds = pcd_b_full.voxel_down_sample(voxel_size)

    # ── Phase 1: ICP with identity init (works when scans are close) ─
    reg_identity = o3d.pipelines.registration.registration_icp(
        pcd_b_ds, pcd_a_ds, icp_threshold, np.eye(4),
        o3d.pipelines.registration.TransformationEstimationPointToPoint(),
    )
    logger.info("Identity-init ICP fitness=%.4f, RMSE=%.6f",
                reg_identity.fitness, reg_identity.inlier_rmse)

    # ── Phase 2: FPFH+RANSAC fallback if identity init is poor ───────
    if reg_identity.fitness < ICP_FITNESS_WARNING_THRESHOLD:
        logger.info("Identity-init ICP insufficient, running FPFH+RANSAC…")
        coarse_transform = _coarse_registration(pcd_b_ds, pcd_a_ds, icp_threshold, diag)
        reg_coarse = o3d.pipelines.registration.registration_icp(
            pcd_b_ds, pcd_a_ds, icp_threshold, coarse_transform,
            o3d.pipelines.registration.TransformationEstimationPointToPoint(),
        )
        logger.info("RANSAC-init ICP fitness=%.4f, RMSE=%.6f",
                     reg_coarse.fitness, reg_coarse.inlier_rmse)
        reg = reg_coarse if reg_coarse.fitness > reg_identity.fitness else reg_identity
    else:
        reg = reg_identity

    logger.info("Final ICP fitness=%.4f, RMSE=%.6f", reg.fitness, reg.inlier_rmse)

    if reg.fitness < ICP_FITNESS_WARNING_THRESHOLD:
        logger.warning("Low ICP fitness (%.4f < %.4f) — alignment may be unreliable",
                       reg.fitness, ICP_FITNESS_WARNING_THRESHOLD)

    # ── Apply transform ──────────────────────────────────────────────
    mesh_b_aligned = o3d.geometry.TriangleMesh(mesh_b)
    mesh_b_aligned.transform(reg.transformation)

    # ── Aggregate stats from uniform samples (symmetric Hausdorff) ───
    sample_count = min(
        max(len(np.asarray(mesh_a.vertices)), len(np.asarray(mesh_b.vertices))),
        DEFAULT_SAMPLE_COUNT,
    )
    pcd_a_samp = mesh_a.sample_points_uniformly(number_of_points=sample_count)
    pcd_b_samp = mesh_b_aligned.sample_points_uniformly(number_of_points=sample_count)
    dists_a = np.asarray(pcd_a_samp.compute_point_cloud_distance(pcd_b_samp))
    dists_b = np.asarray(pcd_b_samp.compute_point_cloud_distance(pcd_a_samp))
    all_dists = np.concatenate([dists_a, dists_b])

    # Per-vertex distances for heatmap: query each vertex of mesh_a against
    # all vertices of aligned mesh_b via point cloud nearest-neighbour.
    pcd_b_verts = o3d.geometry.PointCloud()
    pcd_b_verts.points = o3d.utility.Vector3dVector(np.asarray(mesh_b_aligned.vertices))

    pcd_a_verts = o3d.geometry.PointCloud()
    pcd_a_verts.points = o3d.utility.Vector3dVector(np.asarray(mesh_a.vertices))

    vertex_dists = np.asarray(pcd_a_verts.compute_point_cloud_distance(pcd_b_verts))
    logger.info(
        "Per-vertex distances: %d vertices, mean=%.6f, max=%.6f",
        len(vertex_dists), float(np.mean(vertex_dists)), float(np.max(vertex_dists)),
    )

    # Volume via convex hull (approximation)
    try:
        vol_a = mesh_a.get_volume() if mesh_a.is_watertight() else 0.0
    except Exception:
        vol_a = 0.0
    try:
        vol_b = mesh_b_aligned.get_volume() if mesh_b_aligned.is_watertight() else 0.0
    except Exception:
        vol_b = 0.0
    logger.info("Volumes: A=%.6f, B=%.6f, delta=%.6f", vol_a, vol_b, vol_b - vol_a)

    bbox_a = mesh_a.get_axis_aligned_bounding_box()
    bbox_b = mesh_b_aligned.get_axis_aligned_bounding_box()

    return DiffResult(
        mean_distance=float(np.mean(all_dists)),
        max_distance=float(np.max(all_dists)),
        std_distance=float(np.std(all_dists)),
        volume_a=vol_a,
        volume_b=vol_b,
        volume_delta=vol_b - vol_a,
        bbox_a=(bbox_a.max_bound - bbox_a.min_bound).tolist(),
        bbox_b=(bbox_b.max_bound - bbox_b.min_bound).tolist(),
        per_vertex_distances=vertex_dists.tolist(),
        icp_fitness=float(reg.fitness),
        icp_rmse=float(reg.inlier_rmse),
    )


def export_diff_glb(
    mesh: o3d.geometry.TriangleMesh,
    distances: list[float],
    output_path: str,
) -> str:
    """Bake per-vertex distance heatmap into vertex colors and export GLB."""
    import matplotlib.cm as cm

    n_verts = len(np.asarray(mesh.vertices))
    dists = np.array(distances)

    if len(dists) != n_verts:
        raise ValueError(
            f"Distance count ({len(dists)}) does not match "
            f"mesh vertex count ({n_verts})"
        )

    # Percentile clamp: cap at 95th percentile so outliers don't wash out.
    # Floor at 1% of bbox diagonal so near-zero noise doesn't get amplified.
    if dists.max() > 0:
        bbox = mesh.get_axis_aligned_bounding_box()
        diag = float(np.linalg.norm(bbox.max_bound - bbox.min_bound))
        min_clamp = diag * 0.01  # 1% of diagonal ≈ 3.5mm for a 350mm scan
        clamp = max(np.percentile(dists, HEATMAP_PERCENTILE_CLAMP), min_clamp)
        clamped = np.clip(dists, 0, clamp)
        normalized = clamped / clamp
    else:
        normalized = dists

    # Map 0→blue, 1→red using jet colormap
    colors_rgba = cm.jet(normalized)
    colors_rgb = colors_rgba[:, :3]

    colored_mesh = o3d.geometry.TriangleMesh(mesh)
    colored_mesh.vertex_colors = o3d.utility.Vector3dVector(colors_rgb)

    logger.info("Exporting diff heatmap to %s", output_path)
    return export_glb(colored_mesh, output_path)
