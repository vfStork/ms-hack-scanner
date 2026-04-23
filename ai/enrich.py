from __future__ import annotations

import json
import logging

import numpy as np
import open3d as o3d
import openai
from pydantic import BaseModel, Field

from ai import get_openai_client, get_deployment

logger = logging.getLogger(__name__)

_FALLBACK = {
    "material": None,
    "component_class": None,
    "lifespan_years": None,
    "confidence": None,
    "reasoning": None,
    "source": "ai_estimate_failed",
}


class EnrichmentResult(BaseModel):
    """Validates the expected shape of the LLM enrichment response."""
    material: str | None = None
    component_class: str | None = None
    lifespan_years: float | None = None
    confidence: str | None = Field(None, description="low / medium / high")
    reasoning: str | None = None


def _geometry_summary(mesh: o3d.geometry.TriangleMesh) -> dict:
    """Extract numeric geometry stats for the LLM prompt.

    NOTE: dimension keys use the suffix ``_m`` (meters) by convention, but
    the actual unit depends on the scanner / source file. Most consumer and
    industrial scanners export in millimeters. No upstream unit detection
    exists yet, so treat the values as "native scan units".
    """
    verts = np.asarray(mesh.vertices)
    bbox = mesh.get_axis_aligned_bounding_box()
    dims = bbox.max_bound - bbox.min_bound

    try:
        volume = mesh.get_volume() if mesh.is_watertight() else None
    except Exception:
        volume = None

    try:
        area = mesh.get_surface_area()
    except Exception:
        area = None

    return {
        "vertex_count": len(verts),
        "triangle_count": len(np.asarray(mesh.triangles)),
        "bounding_box_dimensions_native_unit": {
            "x": round(float(dims[0]), 4),
            "y": round(float(dims[1]), 4),
            "z": round(float(dims[2]), 4),
        },
        "volume_native_unit3": round(volume, 6) if volume else None,
        "surface_area_native_unit2": round(area, 6) if area else None,
        "is_watertight": mesh.is_watertight(),
    }


def enrich_twin(mesh: o3d.geometry.TriangleMesh) -> dict:
    """Ask Azure OpenAI to estimate material, component class, and lifespan."""
    client = get_openai_client()
    deployment = get_deployment()

    stats = _geometry_summary(mesh)

    try:
        response = client.chat.completions.create(
            model=deployment,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an industrial engineering assistant. "
                        "Given 3D scan geometry statistics of a physical asset, "
                        "estimate: 1) the likely material, 2) the component class "
                        "(e.g. valve, pipe, bracket, housing), and 3) estimated "
                        "lifespan in years. Respond ONLY with a JSON object with "
                        'keys: "material", "component_class", "lifespan_years", '
                        '"confidence", "reasoning".\n\n'
                        "NOTE: Dimensions are in the scanner's native unit "
                        "(commonly millimeters). The geometry alone cannot "
                        "confirm material — provide your best estimate and set "
                        "confidence accordingly."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Geometry stats:\n{json.dumps(stats, indent=2)}",
                },
            ],
            temperature=0.2,
            max_completion_tokens=300,
            response_format={"type": "json_object"},
        )

        if response.usage:
            logger.info(
                "enrich_twin tokens: prompt=%d, completion=%d, total=%d",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
                response.usage.total_tokens,
            )

        raw = json.loads(response.choices[0].message.content)
        validated = EnrichmentResult(**raw)
        result = validated.model_dump()
        result["source"] = "ai_estimate"
        return result

    except (openai.APIError, openai.APITimeoutError, openai.RateLimitError) as exc:
        logger.error("Azure OpenAI API error in enrich_twin: %s", exc)
        return dict(_FALLBACK)
    except (json.JSONDecodeError, Exception) as exc:
        logger.error("Failed to parse/validate enrichment response: %s", exc)
        return dict(_FALLBACK)
