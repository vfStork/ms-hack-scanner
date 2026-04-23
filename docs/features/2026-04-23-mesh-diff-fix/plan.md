# Plan: Fix Mesh Comparison Pipeline

## TL;DR
The mesh diff pipeline (sample → ICP align → measure distance → heatmap) uses the right approach but has a critical data mismatch: distances are computed on 50k sampled points, then applied to actual mesh vertices via `np.resize()` which tiles/wraps values, producing a spatially meaningless heatmap. ICP alignment can also silently fail with no quality check. Fix by computing distances directly on mesh vertices, validating ICP fitness, and improving heatmap normalization.

## Steps

### Phase 1: Fix heatmap data pipeline (critical)
1. In `pipeline/diff.py` → `compute_diff()`, after ICP alignment, build a KD-tree from the aligned point cloud B and query distances for every *actual vertex* of mesh A (not sampled points). Store these true per-vertex distances in `DiffResult.per_vertex_distances`. Keep the sampled-point approach for aggregate stats (mean, max, std) since symmetric sampling is appropriate there.
   - Rename `per_vertex_distances` field to clarify it maps 1:1 to mesh A vertices
   - Remove the `np.resize()` hack in `export_diff_glb()` — after this fix, `len(distances) == len(mesh.vertices)` always holds; raise `ValueError` if it doesn't
   - *Files*: `pipeline/diff.py`

2. In `pipeline/diff.py` → `export_diff_glb()`, replace global-max normalization with percentile clamping (95th percentile) so outlier distances don't wash out the heatmap.
   - Clamp at `np.percentile(dists, 95)` before normalizing to 0–1
   - *Files*: `pipeline/diff.py`

### Phase 2: Validate ICP registration
3. After `registration_icp()`, check `reg.fitness` and `reg.inplace_rmse`. If `fitness < 0.3`, log a warning via the `logging` module and include the fitness score in `DiffResult` so callers can surface it.
   - Add `icp_fitness: float` and `icp_rmse: float` fields to `DiffResult` dataclass
   - Add these to `to_dict()` output so the API and CLI both report alignment quality
   - *Files*: `pipeline/diff.py`

4. Add a coarse pre-alignment step using FPFH feature extraction + RANSAC global registration before fine ICP. This handles scans that start in very different poses where point-to-point ICP (identity init) would converge to a local minimum.
   - Compute normals on both point clouds (`estimate_normals`)
   - Compute FPFH features (`compute_fpfh_feature`)
   - Run `registration_ransac_based_on_feature_matching` to get a coarse transform
   - Feed the coarse transform as the `init` parameter to `registration_icp` instead of `np.eye(4)`
   - *Files*: `pipeline/diff.py`

### Phase 3: Parameterization & documentation
5. Make sample count proportional to mesh complexity instead of fixed at 50,000. Use `min(len(mesh.vertices), 50_000)` as a starting heuristic. Extract the default as a named constant `DEFAULT_SAMPLE_COUNT` near the top of the file.
   - *Files*: `pipeline/diff.py`

6. Document the unit convention for `icp_threshold`. Add a docstring note that the default `0.05` assumes meter-scale scans. Group all processing constants at the top of the file with comments explaining their purpose.
   - Extract constants: `ICP_THRESHOLD`, `DEFAULT_SAMPLE_COUNT`, `ICP_FITNESS_WARNING_THRESHOLD`, `HEATMAP_PERCENTILE_CLAMP`
   - *Files*: `pipeline/diff.py`

7. Add `logging` calls at key stages: before/after ICP (with fitness), volume computation results, sample counts used, and heatmap export path.
   - *Files*: `pipeline/diff.py`

## Relevant Files
- `pipeline/diff.py` — all core changes: vertex-based distances, ICP validation, FPFH pre-alignment, heatmap normalization, constants, logging
- `main.py` — `cmd_compare()` may surface ICP fitness in CLI output (no structural change)
- `api/routes.py` — `compare()` endpoint already forwards `diff.to_dict()` so new fields propagate automatically

## Verification
1. Run `cmd_compare` on two versions of the same twin — heatmap colors should be spatially coherent (nearby vertices have similar colors, not random stripes)
2. Confirm `len(diff.per_vertex_distances) == len(mesh_a.vertices)` in all cases
3. Deliberately load two scans with different initial orientations — FPFH+RANSAC pre-alignment should produce a reasonable coarse transform, ICP refines it, fitness > 0.3
4. Load two completely unrelated meshes — ICP fitness should be low, warning logged
5. Introduce one outlier point with huge distance — heatmap should still show useful color variation (percentile clamp working)
6. Confirm `to_dict()` output now includes `icp_fitness` and `icp_rmse`
7. Verify `export_diff_glb` raises `ValueError` if distance/vertex count mismatch

## Decisions
- Vertex-based distance query (KD-tree from aligned B → query each vertex of A) rather than projecting sampled-point distances back. Direct computation is simpler, exact, and avoids interpolation artifacts.
- Keep sampled-point approach for aggregate stats (mean, max, std) because symmetric two-direction sampling is the standard Hausdorff-like metric. Vertex-based is only for heatmap visualization.
- 95th percentile clamp for heatmap normalization — balances outlier resistance with showing the full range. Configurable via constant.
- FPFH + RANSAC before ICP rather than only ICP — adds ~1–2s of compute but makes the pipeline robust to arbitrary initial poses. Without it, the pipeline only works if scans are pre-aligned or very close.
- Fitness threshold 0.3 for warning, not hard failure — poor alignment might still be useful information (e.g., the object changed dramatically). Callers decide how to handle it.
- All distances remain unsigned (nearest-neighbor magnitude). Signed distance would require consistent normals and watertight meshes, which scanner data rarely guarantees.
