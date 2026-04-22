# Copilot Instructions

## Project Context

This repository is a Python project for 3D scan cleanup using Open3D.
Primary script: main.py.

## Coding Guidelines

- Keep code simple and readable.
- Prefer small, testable functions over long scripts.
- Preserve existing behavior unless explicitly changing it.
- Add brief comments only where logic is non-obvious.
- Avoid introducing heavy dependencies unless necessary.

## When Modifying Processing Logic

- Keep processing steps explicit and deterministic.
- Document parameter choices (for example `depth`, `nb_neighbors`, `std_ratio`).
- Prefer configurable constants over hard-coded magic values.

## Validation Expectations

- Verify scripts run without syntax errors.
- If adding new files, keep paths and usage documented in README.
