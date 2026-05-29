# Sphere Reference Node

Minimal local reference node for Sphere core experiments.

The node uses `@sphere/event-store` and replays each chain into an in-memory graph projection for queries. It defaults to memory storage, but can use SQLite persistence via `SPHERE_NODE_DB`.

## Development

```bash
pnpm --filter @sphere/node test
pnpm --filter @sphere/node typecheck
```

## Storage

Default storage is memory-only:

```bash
pnpm --filter @sphere/node test
```

Set `SPHERE_NODE_DB` when starting the node to use SQLite-backed event storage:

```bash
SPHERE_NODE_DB=./sphere-events.sqlite SPHERE_NODE_PORT=3080 pnpm --filter @sphere/node start
```

The current package exposes `startNodeApp()` for runtime entrypoints; a CLI/bin wrapper is still a later step.

## API surface

```text
GET  /health
GET  /node/info
POST /chains/:chainId/events
GET  /chains/:chainId/events
GET  /chains/:chainId/graph/entities/:entityId
GET  /chains/:chainId/graph/edges/from/:entityId
GET  /chains/:chainId/graph/edges/to/:entityId
GET  /chains/:chainId/graph/identity/:platform/:platformId
GET  /chains/:chainId/graph/diagnostics
```

`GET /node/info` reports the active storage backend as either `memory` or `sqlite`.

## Current behavior

- Appends verified event-chain batches.
- Rejects invalid/tampered/non-contiguous event batches without mutating stored events.
- Returns stored events by chain id.
- Projects stored events into graph state for entity, edge, identity, and diagnostic queries.
- Supports memory and SQLite event storage.
