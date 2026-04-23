## Plan: VLM Comparison Inspection

This feature enhances backend comparison insights by moving beyond basic geometry summaries. We will use Open3D's headless renderer to generate 4 orthogonal snapshots of the diff heatmap, feeding them directly to a vision-capable language model (like GPT-4o) for human-like visual inspection. This allows the AI to pinpoint _where_ and _what_ changed, rather than just reciting global averages.

**Steps**

1. **Implement headless rendering** — Create `pipeline/render.py` with a function `generate_diff_snapshots(mesh, base_path)` that sets up `o3d.visualization.rendering.OffscreenRenderer`. Configure the camera for 4 orthogonal views (Top, Front, Left, Right) and save 4 separate PNGs.
2. **Integrate snapshots into compare flow** — In `api/routes.py`, within the `/compare` endpoint, invoke `generate_diff_snapshots` immediately after `export_diff_glb`. Store the image paths contextually. Apply the same logic in `main.py`'s `cmd_compare`.
3. **Enhance AI payload for multimodality** — In `ai/describe.py` -> `describe_changes()`, add a new `image_paths` parameter. Read the 4 PNGs from disk, encode them as Base64, and convert the `user` message into An array format mapping text and images (`type: "image_url"`).
4. **Update the Prompt** — Update the `system` message in `describe_changes()` to explicitly instruct the model to analyze the provided geometric heatmap snapshots (where red indicates severe changes) to describe the exact physical shape and location of the differences.

**Relevant files**

- `pipeline/render.py` — newly added module to hold the `OffscreenRenderer` logic, decoupled from core math.
- `api/routes.py` — orchestrates rendering and delegates image arrays to the AI, modifying POST `/compare`.
- `main.py` — applies the same rendering flow for the CLI compare command.
- `ai/describe.py` — modifies payload structure to multi-modal specs and ingests Base64.

**Verification**

1. Run `python main.py compare <twin-id> 1 2` via CLI. Verify 4 PNGs (e.g., `_top.png`, `_front.png`) populate next to the `.glb` in the twins directory.
2. Check the Azure OpenAI API request to ensure `image_url` payloads are structurally valid and base64 encoded.
3. Review the returned `description` from the backend to confirm the AI references spatial cues (e.g., "The red hotspots on the front-facing snapshot indicate localized wear...").

**Decisions**

- Storing images alongside the `.glb` long-term helps with debugging the VLM inputs without increasing processing overhead.
- Open3D's `OffscreenRenderer` is chosen over introducing PyVista to keep dependencies slim, given Open3D is already in the `requirements.txt`.
- Taking 4 orthogonal bounds avoids occlusions without flooding the LLM token constraints.
