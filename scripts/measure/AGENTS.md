# Measure scripts

`pnpm measure [area] [--log <path>] [--digest]`. Node, no DOM.

- Keep few areas. One area per user path with a budget.
- Add an area only for a new budgeted path. Never one per PR.
- PR-specific timings or digests: local only. Do not commit the script or its `AREAS` entry.
- Quote before/after numbers from the committed areas where they cover the change.
- A `--digest` is a correctness check. Keep its output stable across revisions.
