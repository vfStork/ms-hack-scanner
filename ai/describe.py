from __future__ import annotations

import json
import os
from openai import AzureOpenAI
from dotenv import load_dotenv

from pipeline.diff import DiffResult

load_dotenv()


def _get_client() -> AzureOpenAI:
    return AzureOpenAI(
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_KEY"],
        api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-21"),
    )


def describe_changes(diff: DiffResult, twin_metadata: dict) -> str:
    """Generate a human-readable description of what changed between two scans."""
    client = _get_client()
    deployment = os.environ["AZURE_OPENAI_DEPLOYMENT"]

    context = {
        "component": twin_metadata.get("component_class", "unknown"),
        "material": twin_metadata.get("material", "unknown"),
        "diff_stats": diff.to_dict(),
    }

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
                    "or modification. Keep it to 2-4 sentences."
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
        max_tokens=200,
    )

    return response.choices[0].message.content.strip()
