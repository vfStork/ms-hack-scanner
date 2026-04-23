# Plan: Persist Transform Settings Per Twin

## TL;DR
When a user adjusts rotation/position via the transform panel, those settings should be saved per twin and automatically re-applied whenever any version of that twin is loaded — including after rescan, compare, version switch, or page reload.

## Problem
Currently, every model load (rescan, compare, version switch) resets all transform sliders to zero. The user has to manually re-orient the model each time. Transform values are purely ephemeral UI state — not stored anywhere.

## Root Causes
- `loadGLB()` creates a fresh pivot group each time (rotation/position zeroed)
- `loadModel()` and `showSideBySide()` explicitly call `resetSliders()`
- No transform state stored in the data model — `Twin` has no `transform` field
- No API endpoint to save/retrieve transform values

## Steps

### Phase 1: Add transform field to Twin model (backend)
1. In `registry/models.py` — Add a `transform: dict` field to the `Twin` dataclass with default `{"rot_x": 0, "rot_y": 0, "rot_z": 0, "pos_x": 0, "pos_y": 0, "pos_z": 0}`.
   - Transform is per twin, not per version — same physical object should be oriented the same way regardless of scan version.
   - *Files*: `registry/models.py`

2. In `registry/store.py` — Add an `update_transform(twin_id, transform_dict)` function that loads the twin, updates the transform field, and saves.
   - *Files*: `registry/store.py`

3. In `api/routes.py` — Add a `PATCH /api/twins/{twin_id}/transform` endpoint that accepts the 6 transform values and calls `update_transform()`. The transform is already included in `twin.to_dict()` via the dataclass, so the GET endpoints return it automatically.
   - *Files*: `api/routes.py`

### Phase 2: Apply stored transform on model load (frontend)
4. In `web/app.js` — Create an `applyTwinTransform(twin)` function that:
   - Reads `twin.transform` from the API response
   - Sets each slider to the stored value
   - Updates the value displays
   - Calls `setRotation()` and `setPositionOffset()` to apply to the viewport
   - *Files*: `web/app.js`

5. Replace all `resetSliders()` calls after model load with `applyTwinTransform()`:
   - `loadModel()` — after `showSingle()`, apply stored transform
   - Compare confirm handler — after `showSideBySide()`, apply stored transform
   - Viewport B toggle — after loading model B, re-apply stored transform
   - *Files*: `web/app.js`

### Phase 3: Save transform on slider change (frontend)
6. In `web/app.js` — In `syncTransformFromSliders()`, after applying transforms to the viewport, debounce a `PATCH` call to `/api/twins/{id}/transform` to save current slider values. Use ~500ms debounce so dragging doesniders doesn't flood the API.
   - *Files*: `web/app.js`

7. Update `resetSliders()` (Reset Transform button) — after zeroing sliders, also fire the debounced save so zeros are persisted.
   - *Files*: `web/app.js`

### Phase 4: No viewer.js changes needed
8. `loadGLB()` creates a fresh pivot group (zeroed). After it resolves, the caller in `app.js` calls `applyTwinTransform()` which sets rotation/position on the new pivot group. The sequencing in app.js handles this — no viewer.js changes required.

## Relevant Files
- `registry/models.py` — Add `transform` field to `Twin` dataclass
- `registry/store.py` — Add `update_transform()` function
- `api/routes.py` — Add `PATCH /api/twins/{id}/transform` endpoint
- `web/app.js` — `applyTwinTransform()`, debounced save, replace `resetSliders()` calls

## Verification
1. Upload a model → set rotation X to 90° via slider → re-select the twin from sidebar → model loads with X=90°
2. Set rotation on v1 → upload rescan (v2) → v2 loads with the same rotation
3. Set rotation → click Compare → both viewports show models with the saved rotation
4. Switch between versions (dropdown) → transform persists
5. Click Reset Transform → sliders zero out, zeros saved to backend
6. Reload the page → select the twin → last saved transform is applied
7. Create a second twin → it starts with default (zero) transforms, unaffected by first twin's settings

## Decisions
- Transform stored **per twin** (not per version) — same object, same orientation
- Backend persistence via JSON file store — survives page reloads and server restarts
- Debounced save (500ms) to avoid API flooding during slider drags
- Reset Transform button zeros sliders AND saves zeros to backend
- No viewer.js changes needed — app.js sequencing applies transform after each `loadGLB` resolves
- Transform dict uses flat keys (`rot_x`, `rot_y`, `rot_z`, `pos_x`, `pos_y`, `pos_z`) for simplicity
