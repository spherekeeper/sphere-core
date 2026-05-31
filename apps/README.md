# Apps

Reference applications and developer-facing executables for the current Sphere core workspace.

These directories are currently workspace/source apps inside the `sphere-core` monorepo. They are not published npm packages, and they should be treated as reference/developer tooling rather than standalone releases.

Current apps:

- [`node`](node/README.md) — minimal local reference node for trusted development and protocol experiments.
- [`demo`](demo/README.md) — minimal demo CLI for exercising a running reference node.

These are still reference tools rather than production services, and they may move into separate repositories later if their release cadence or operational boundaries diverge from `sphere-core`.
