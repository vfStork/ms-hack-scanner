# AGENTS

Guidance for AI coding agents working in this repository.

## Mission

Maintain and improve a Python/Open3D scan-cleaning workflow with safe, minimal changes.

## Operating Rules

- Do not rewrite the whole pipeline when only one step needs change.
- Keep file I/O explicit (input and output paths visible in code).
- Add or update README when behavior or usage changes.
- Prefer backward-compatible changes.

## Code Style

- Use clear variable names that map to geometry concepts.
- Keep processing parameters grouped near the top of scripts.
- Extract complex operations into helper functions when needed.

## Safety

- Avoid destructive filesystem operations by default.
- Do not remove user data or overwrite source scans unless requested.
