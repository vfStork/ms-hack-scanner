from __future__ import annotations

import json
import os
import numpy as np
import open3d as o3d
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()


def _get_client() -> OpenAI:
    return OpenAI(
        base_url=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_KEY"],
    )


def _geometry_summary(mesh: o3d.geometry.TriangleMesh) -> dict:
    """Extract numeric geometry stats for the LLM prompt."""
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
        "bounding_box_dimensions_m": {
            "x": round(float(dims[0]), 4),
            "y": round(float(dims[1]), 4),
            "z": round(float(dims[2]), 4),
        },
        "volume_m3": round(volume, 6) if volume else None,
        "surface_area_m2": round(area, 6) if area else None,
        "is_watertight": mesh.is_watertight(),
    }


def enrich_twin(mesh: o3d.geometry.TriangleMesh) -> dict:
    """Ask Azure OpenAI to estimate material, component class, and lifespan."""
    client = _get_client()
    deployment = os.environ["AZURE_OPENAI_DEPLOYMENT"]

    stats = _geometry_summary(mesh)

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
                    '"confidence", "reasoning".'
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

    return json.loads(response.choices[0].message.content)
