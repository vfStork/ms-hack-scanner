from __future__ import annotations

import json
import os
import base64
from openai import OpenAI
from dotenv import load_dotenv

from pipeline.diff import DiffResult

load_dotenv()


def _get_client() -> OpenAI:
    return OpenAI(
        base_url=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_KEY"],
    )


def describe_changes(diff: DiffResult, twin_metadata: dict, image_paths: list[str] = None) -> str:
    """Generate a human-readable description of what changed between two scans."""
    client = _get_client()
    deployment = os.environ["AZURE_OPENAI_DEPLOYMENT"]

    context = {
        "component": twin_metadata.get("component_class", "unknown"),
        "material": twin_metadata.get("material", "unknown"),
        "diff_stats": diff.to_dict(),
    }

    user_content = [
        {
            "type": "text",
            "text": f"Twin metadata & diff:\n{json.dumps(context, indent=2)}"
        }
    ]

    if image_paths:
        for img_path in image_paths:
            with open(img_path, "rb") as img_file:
                b64_img = base64.b64encode(img_file.read()).decode("utf-8")
            user_content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{b64_img}"
                }
            })

    response = client.chat.completions.create(
        model=deployment,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a digital-twin inspection assistant. "
                    "Given diff statistics between two 3D scans of a physical "
                    "asset and its metadata, write a concise natural-language "
                    "description of the changes. Focus on distinguishing minor "
                    "noise/misalignment from meaningful physical changes like wear, "
                    "damage, or the addition/removal of material. Emphasize "
                    "alignment_fitness, inlier rmse, percentiles (p90, p95), and "
                    "volume changes if present. "
                    "Also analyze the provided geometric heatmap snapshots (where red indicates severe changes) "
                    "to describe the exact physical shape and location of the differences. "
                    "Keep it to 2-4 sentences."
                ),
            },
            {
                "role": "user",
                "content": user_content,
            },
        ],
        temperature=0.3,
        max_completion_tokens=200,
    )

    return response.choices[0].message.content.strip()
