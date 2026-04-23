# Plan: Improve AI Integration Layer

## TL;DR
The AI layer has two modules: `describe.py` (summarize scan diffs) and `enrich.py` (guess material/component from geometry). The describe module works but sends under-specified prompts with no units and thin statistics. The enrich module attempts an impossible task — identifying material from geometry stats alone — and its unreliable output feeds into describe as trusted context. Fix by enriching the prompts, adding error handling, validating outputs, and tagging AI estimates as such.

## Prerequisites
- **Depends on**: "Fix Mesh Comparison Pipeline" plan landing first. That plan adds `icp_fitness` and `icp_rmse` to `DiffResult.to_dict()`, which this plan's prompt improvements should reference.

## Steps

### Phase 1: Fix describe_changes prompt (high impact, low effort)
1. Add unit labels to all numeric values in the prompt. State the unit convention (meters) explicitly in the system message so the LLM can assess whether `mean_distance: 0.003` is 3mm of wear or 3 microns of noise.
   - Update the system prompt to include: "All distances are in meters. Volumes are in cubic meters."
   - *Files*: `ai/describe.py`

2. Add distribution summary fields to the diff context sent to the LLM. Compute and include: median distance, 90th percentile, 95th percentile, and percentage of surface area above a deviation threshold (e.g., 1mm). These give the LLM real signal about whether change is localized or widespread.
   - Add helper function to compute summary from `per_vertex_distances`
   - Add `median_distance`, `p90_distance`, `p95_distance`, `pct_above_1mm` to the context dict
   - After the diff pipeline fix lands, also include `icp_fitness` and `icp_rmse` in the context
   - *Files*: `ai/describe.py`, `pipeline/diff.py` (add fields to `to_dict()` or compute in describe)

3. Add error handling around the Azure OpenAI API call. Catch `openai.APIError`, `openai.APITimeoutError`, and `openai.RateLimitError`. Return a fallback string like `"AI description unavailable — diff stats are included above."` instead of crashing.
   - *Files*: `ai/describe.py`

### Phase 2: Fix enrich_twin reliability
4. Add output validation for `enrich_twin`. Parse the LLM response through a Pydantic model with expected keys (`material`, `component_class`, `lifespan_years`, `confidence`, `reasoning`). If validation fails, return a default dict with `"source": "ai_estimate_failed"`.
   - Define `EnrichmentResult` Pydantic model
   - Wrap `json.loads` + validation in try/except
   - *Files*: `ai/enrich.py`

5. Tag all enrichment results with `"source": "ai_estimate"` so downstream consumers (especially `describe_changes`) know this is a guess, not verified data. Update `describe_changes` system prompt to note that twin metadata is AI-estimated and may be inaccurate.
   - Inject `"source": "ai_estimate"` into the returned dict
   - Update describe system prompt: "The twin metadata below is AI-estimated and may be inaccurate."
   - *Files*: `ai/enrich.py`, `ai/describe.py`

6. Add the same error handling pattern to `enrich_twin` — catch API errors, return a fallback dict with null values and `"source": "ai_estimate_failed"`.
   - *Files*: `ai/enrich.py`

7. Fix the unit labels in `_geometry_summary()`. The keys say `_m` (meters) but no upstream code verifies the scan unit. Add a comment documenting the assumption and consider adding a `unit` field to twin metadata so the prompt can adapt.
   - *Files*: `ai/enrich.py`

### Phase 3: Shared infrastructure
8. Extract the duplicated `_get_client()` and `load_dotenv()` into `ai/__init__.py` as a shared helper. Both `describe.py` and `enrich.py` import from there.
   - Move `_get_client()` to `ai/__init__.py` as `get_openai_client()`
   - Update imports in both modules
   - *Files*: `ai/__init__.py`, `ai/describe.py`, `ai/enrich.py`

9. Log token usage from `response.usage` after each API call via the `logging` module. This provides visibility into cost accumulation across scans.
   - *Files*: `ai/describe.py`, `ai/enrich.py`

## Relevant Files
- `ai/describe.py` — prompt improvements, distribution stats, error handling, unit labels
- `ai/enrich.py` — output validation, source tagging, error handling, unit labels
- `ai/__init__.py` — shared client helper
- `pipeline/diff.py` — may add distribution fields to `to_dict()` (or compute in describe)

## Verification
1. Run `describe_changes` with a known diff — output should reference specific measurements with units (e.g., "3.2mm mean deviation") instead of vague statements
2. Simulate Azure OpenAI timeout — `describe_changes` returns fallback string, does not crash
3. Simulate Azure OpenAI timeout — `enrich_twin` returns fallback dict with `"source": "ai_estimate_failed"`
4. Run `enrich_twin` — returned dict always contains `"source": "ai_estimate"` key
5. Force LLM to return malformed JSON from enrich — Pydantic validation catches it, fallback returned
6. Check logs after a compare operation — token usage logged for both API calls
7. Verify `ai/__init__.py` exports `get_openai_client()` and both modules use it (no duplicated client code)

## Decisions
- Fallback strings/dicts on API failure rather than retries. Retries add latency and complexity; the diff stats are already available to the user without AI description. Can add retry later if needed.
- Pydantic validation for enrich output rather than manual key checks. Pydantic is already a project dependency (FastAPI layer) so no new dependency.
- Source tagging (`"ai_estimate"`) rather than a separate confidence threshold gate. Simpler, and lets the UI/caller decide how to present uncertain data.
- Distribution stats computed in `describe.py` from `per_vertex_distances` rather than adding more fields to `DiffResult.to_dict()`. Keeps the diff module focused on geometry; the AI module computes what it needs for prompting.
- Unit convention documented as meters (matching `_geometry_summary` key suffixes) but not enforced at scan ingestion. True unit detection would require scanner metadata parsing, which is out of scope.
- `enrich_twin` kept as-is functionally (geometry-only input) but clearly labeled as estimate. A future phase could add rendered images or user hints to improve accuracy, but that's a separate plan.
