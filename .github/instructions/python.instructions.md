---
applyTo: "**/*.py"
---

# Python Coding Instructions

These instructions guide GitHub Copilot for this Python/Open3D project.

## Context

- **Language**: Python 3.10 or 3.11 (Open3D `>=0.18` wheels are published for 3.8–3.11; Python 3.12+ is only supported from Open3D 0.19 onwards — do not assume a newer Python version is safe)
- **Domain**: 3D scan processing and cleanup
- **Key Libraries**: Open3D, NumPy, FastAPI (API layer), Pydantic

## General Guidelines

- Follow PEP 8 and PEP 257 conventions.
- Use type hints throughout (`from __future__ import annotations` where helpful).
- Prefer named functions over inline lambdas.
- Use meaningful variable names that map to geometry/domain concepts.
- Keep processing steps explicit and deterministic.

## Processing Parameters

- Group configurable parameters (e.g. `depth`, `nb_neighbors`, `std_ratio`) near the top of scripts or functions as named constants.
- Document why each parameter value was chosen in a comment.
- Never hardcode magic numbers inline — assign them to a named constant first.

## File I/O

- Keep input and output paths explicit and visible in code.
- Do not overwrite source scans unless explicitly requested.
- Use pathlib (`Path`) for all file path handling.

## Patterns to Follow

- Prefer small, single-purpose helper functions over long scripts.
- Use custom exceptions for domain-specific error conditions.
- Use `logging` module for diagnostic output — not `print`.
- Use environment variables via `python-dotenv` or `os.environ` for config.

## Patterns to Avoid

- No wildcard imports (`from module import *`).
- No global mutable state.
- No hardcoded secrets or absolute paths.
- No business logic mixed into I/O or route handlers.

## Testing

- Use `pytest` for unit tests.
- Mock file I/O and Open3D calls where possible to keep tests fast.
- Test both typical inputs and edge cases (empty point clouds, missing files).

## References

- [PEP 8](https://peps.python.org/pep-0008/)
- [PEP 484 – Type Hints](https://peps.python.org/pep-0484/)
- [Open3D Documentation](http://www.open3d.org/docs/release/)
- [Pytest Documentation](https://docs.pytest.org/en/stable/)
