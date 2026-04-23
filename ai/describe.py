from __future__ import annotations

import json
import logging

import numpy as np
import openai

from ai import get_openai_client, get_deployment
from pipeline.diff import DiffResult

logger = logging.getLogger(__name__)

_FALLBACK = "AI description unavailable — diff stats are included above."


def _distribution_summary(per_vertex_distances: list[float]) -> dict:
    """Compute distribution stats from per-vertex distances for the LLM prompt."""
    if not per_vertex_distances:
        return {}
    d = np.array(per_vertex_distances)
    return {
        "median_distance": round(float(np.median(d)), 6),
        "p90_distance": round(float(np.percentile(d, 90)), 6),
        "p95_distance": round(float(np.percentile(d, 95)), 6),
        "pct_above_1mm": round(float(np.mean(d > 1.0) * 100), 2),
    }


def describe_changes(diff: DiffResult, twin_metadata: dict) -> str:
    """Generate a human-readable description of what changed between two scans."""
    client = get_openai_client()
    deployment = get_deployment()

    context = {
        "component": twin_metadata.get("component_class", "unknown"),
        "material": twin_metadata.get("material", "unknown"),
        "metadata_source": twin_metadata.get("source", "unknown"),
        "diff_stats": diff.to_dict(),
        "distribution": _distribution_summary(diff.per_vertex_distances),
    }

    try:
        response = client.chat.completions.create(
            model=deployment,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a digital-twin inspection assistant. "
                        "Given diff statistics between two 3D scans of a physical "
                        "asset and its metadata, write a concise natural-language "
                        "description of the changes. Focus on: what changed, how "
                        "significant it is, and whether it suggests wear, damage, "
                        "or modification. Keep it to 2-4 sentences.\n\n"
                        "IMPORTANT CONTEXT:\n"
                        "- All distances are in the scan's native unit (commonly "
                        "millimeters for consumer/industrial scanners). A mean "
                        "distance under ~1.0 is typically scanner noise, not real "
                        "change.\n"
                        "- Volumes are in cubic native units.\n"
                        "- icp_fitness ranges 0-1; values above 0.5 indicate good "
                        "alignment. Below 0.3 means the scans may not have aligned "
                        "well and reported differences could be registration error.\n"
                        "- The twin metadata below is AI-estimated and may be "
                        "inaccurate. Do not treat component_class or material as "
                        "confirmed facts.\n"
                        "- The distribution section shows median, 90th/95th "
                        "percentile distances, and the percentage of surface above "
                        "1mm deviation. Use these to judge whether change is "
                        "localized or widespread."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Twin metadata & diff:\n{json.dumps(context, indent=2)}"
                    ),
                },
            ],
            temperature=0.3,
            max_completion_tokens=200,
        )

        if response.usage:
            logger.info(
                "describe_changes tokens: prompt=%d, completion=%d, total=%d",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
                response.usage.total_tokens,
            )

        return response.choices[0].message.content.strip()

    except (openai.APIError, openai.APITimeoutError, openai.RateLimitError) as exc:
        logger.error("Azure OpenAI API error in describe_changes: %s", exc)
        return _FALLBACK
