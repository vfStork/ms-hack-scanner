from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

logger = logging.getLogger(__name__)


def get_openai_client() -> OpenAI:
    """Return a configured Azure OpenAI client."""
    return OpenAI(
        base_url=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_KEY"],
    )


def get_deployment() -> str:
    """Return the Azure OpenAI deployment name."""
    return os.environ["AZURE_OPENAI_DEPLOYMENT"]
