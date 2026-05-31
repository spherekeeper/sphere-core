# Packages

Reusable TypeScript packages for Sphere core.

These directories are currently workspace/source packages inside the `sphere-core` monorepo. They are not published to npm yet, and their current package metadata is aimed at local workspace consumption and direct repository checkout.

Current packages:

- [`types`](types/README.md) — shared protocol types, constants, and action payload definitions.
- [`schemas`](schemas/README.md) — runtime validation helpers for draft protocol objects.
- [`ids`](ids/README.md) — UUIDv7-compatible identifier helpers.
- [`events`](events/README.md) — canonical serialization, event hashing, and chain verification helpers.
- [`graph`](graph/README.md) — in-memory graph projection and diagnostics helpers.
- [`event-store`](event-store/README.md) — event store abstractions plus in-memory and SQLite-backed implementations.
- [`commands`](commands/README.md) — command-to-event helpers and reference-node client utilities.

Additional packages can still be extracted later if protocol boundaries stabilize enough to justify them, but the list above reflects the code that exists in this repository today.

Some package directories remain as reserved placeholders for future work (`adapter-contract`, `identity`, and `testing`). They are intentionally not active workspace packages yet.
