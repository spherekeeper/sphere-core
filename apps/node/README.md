# Sphere Reference Node

Minimal local reference node for Sphere core experiments.

The node currently uses the in-memory event store from `@sphere/event-store` and replays each chain into an in-memory graph projection for queries. It is intentionally not production-ready persistence yet; SQLite storage is the next planned step.

## Development

```bash
pnpm --filter @sphere/node test
pnpm --filter @sphere/node typecheck
```

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

## Current behavior

- Appends verified event-chain batches.
- Rejects invalid/tampered/non-contiguous event batches without mutating stored events.
- Returns stored events by chain id.
- Projects stored events into graph state for entity, edge, identity, and diagnostic queries.
- Uses memory storage only.
