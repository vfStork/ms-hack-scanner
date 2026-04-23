# Plan: Model Orientation & Transform Controls

## TL;DR
STL/PLY scans often use Z-up coordinates while Three.js/glTF uses Y-up, causing models to appear rotated (e.g., a mug upside-down). Fix by auto-correcting the up-axis on GLB export, placing the model on the grid, and providing a floating transform panel with sliders for fine-grained rotation and position control.

## Steps

### Phase 1: Auto-correct up-axis on export (backend) ✅ done
1. In `pipeline/export.py` → `export_glb()`, detect if the mesh bounding box suggests Z-up (height along Z > height along Y) and apply a -90° rotation around the X-axis to convert Z-up → Y-up before exporting to GLB.
   - Apply rotation to the trimesh object before export, not to the Open3D mesh (preserve original data)
   - `export_diff_glb()` in `pipeline/diff.py` calls `export_glb()` internally — gets the fix for free

### Phase 2: Pivot-based model placement (frontend) ✅ done
2. In `web/viewer.js` → `loadGLB()`, after scaling, position the model so its bottom sits on Y=0 (the grid) and center on X/Z. Wrap the model in a `pivotGroup` (`THREE.Group`) at the origin so all transforms pivot around the grid contact point.
3. Update `clear()` and `setWireframe()` to work with the pivot group structure.

### Phase 3: Transform controls panel (frontend) — TODO
Replace the discrete rotation buttons with a floating transform panel containing continuous sliders.

4. **Remove rotation buttons from toolbar** — Remove `btn-rot-x`, `btn-rot-y`, `btn-rot-z`, `btn-rot-reset` and their divider from `#toolbar` in `web/index.html`. Add a single **"⊞ Transform"** toggle button (`btn-transform`) that opens/closes the panel.
   - *Files*: `web/index.html`

5. **Add floating transform panel** — Add a `#transform-panel` div positioned absolutely inside `#viewport-container` (top-right corner, overlaying the viewport). Structure:
   - **Rotation section**: Three range sliders (X, Y, Z), each -180° to 180°, with numeric value display
   - **Position section**: Three range sliders (X, Y, Z), each -1.0 to 1.0 (scene units), with numeric value display
   - **Reset button** at the bottom
   - Panel hidden by default, toggled by the Transform button
   - Style: semi-transparent dark background with `backdrop-filter: blur`, matching existing overlay aesthetics (heatmap legend, viewport labels)
   - *Files*: `web/index.html` — HTML + CSS

6. **Replace rotation methods with continuous transform methods** — In `web/viewer.js`, replace `rotateModel(axis, angleDeg)` and `resetRotation()` with:
   - `setRotation(x, y, z)` — sets absolute rotation in degrees on the `pivotGroup` (Euler angles)
   - `setPositionOffset(x, y, z)` — sets an offset on the `pivotGroup.position` (added on top of the base Y=0 placement)
   - `resetTransform()` — resets both rotation and position offset to defaults
   - Update exported wrapper functions accordingly
   - *Files*: `web/viewer.js`

7. **Wire the panel** — In `web/app.js`:
   - Remove old rotation button refs and handlers
   - Add DOM refs for the transform panel, its 6 sliders, and value displays
   - Toggle button handler to show/hide the panel
   - `input` event listeners on each slider that call the new viewer functions in real-time
   - Reset button handler that zeros all sliders and calls `resetTransform()`
   - Enable/disable the transform button when a twin is selected/deselected
   - *Files*: `web/app.js`

## Relevant Files
- `pipeline/export.py` — Z-up → Y-up auto-correction ✅ done
- `pipeline/diff.py` — inherits fix via `export_glb()` ✅ done
- `web/viewer.js` — `Viewport` class: pivot group, `setRotation()`, `setPositionOffset()`, `resetTransform()`
- `web/index.html` — toolbar transform toggle button + floating `#transform-panel` with sliders
- `web/app.js` — remove old rotation wiring, add slider event listeners and panel toggle

## Verification
1. Upload an STL file (e.g., the mug) — confirm it auto-orients correctly (Y-up) without manual intervention
2. Upload a PLY file that was already Y-up — confirm no double-rotation
3. Click Transform button — panel appears over viewport (top-right), doesn't push layout
4. Drag rotation X slider — model rotates smoothly in real-time around its grid base
5. Drag position Y slider — model moves up/down from the grid
6. Click Reset — all sliders return to zero, model returns to default position
7. Panel stays open while using OrbitControls (no conflicts)
8. Compare mode (side-by-side) — transforms apply to both viewports
9. Wireframe toggle — still works with pivot group structure

## Decisions
- Auto-detection heuristic: if bounding box Z-extent > Y-extent, assume Z-up
- Rotation applied to trimesh before GLB export — raw PLY/Open3D data never modified
- Floating overlay panel (not a sidebar) to avoid layout shifts and preserve viewport space
- Range sliders for continuous control instead of discrete 90° buttons
- Rotation range: -180° to 180° (covers all orientations)
- Position range: -1.0 to 1.0 scene units (adequate for normalized models)
- Absolute values (set), not incremental (add) — sliders represent current state directly
- Rotation pivot at model's base contact with grid (Y=0) via `pivotGroup`
- Manual transforms are client-side only (scene transform), not persisted or re-exported
