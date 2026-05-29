# Sphere Reference Node

Minimal local reference node for Sphere core experiments.

The node uses `@sphere/event-store` and replays each chain into an in-memory graph projection for queries. It defaults to memory storage, but can use SQLite persistence via `SPHERE_NODE_DB`.

## Development

```bash
pnpm --filter @sphere/node test
pnpm --filter @sphere/node typecheck
```

## Running locally

Start the node with memory storage on the default host/port (`0.0.0.0:3080`):

```bash
pnpm --filter @sphere/node start
```

Then check it:

```bash
curl http://127.0.0.1:3080/health
curl http://127.0.0.1:3080/node/info
```

The package also exposes a local `sphere-node` bin for workspace/package-manager use.

## Runtime configuration

Environment variables:

- `SPHERE_NODE_HOST`: listen host, defaults to `0.0.0.0`
- `SPHERE_NODE_PORT`: listen port, defaults to `3080`
- `SPHERE_NODE_DB`: optional SQLite database path; omitted means memory storage

Example with SQLite persistence:

```bash
SPHERE_NODE_DB=./sphere-events.sqlite SPHERE_NODE_PORT=3080 pnpm --filter @sphere/node start
```

The runtime installs SIGINT/SIGTERM handlers and closes Fastify plus closeable event stores during shutdown.

## API surface

```text
GET  /health
GET  /node/info
POST /chains/:chainId/events
POST /chains/:chainId/commands
GET  /chains/:chainId/events
GET  /chains/:chainId/graph/entities
GET  /chains/:chainId/graph/entities/:entityId
GET  /chains/:chainId/graph/edges/from/:entityId
GET  /chains/:chainId/graph/edges/to/:entityId
GET  /chains/:chainId/graph/identity/:platform/:platformId
GET  /chains/:chainId/graph/diagnostics
```

`GET /node/info` reports the active storage backend as either `memory` or `sqlite`.

This reference node is intended for local/trusted development. It does not implement authentication, authorization, or rate limiting yet; do not expose it to untrusted networks without adding those controls.

### Command endpoint

`POST /chains/:chainId/commands` accepts `{ "command": Command }`. Commands are intent-level records and do not carry chain position. The node derives `sequence` and `previousHash` from the current chain tip, converts the command into a hash-linked event, appends it, and returns `{ accepted, chainId, event }`.

Example request:

```bash
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/commands \
  -H 'content-type: application/json' \
  -d '{
    "command": {
      "id": "019e42ae-9c00-7000-8000-000000000100",
      "actorId": "019e42ae-9c00-7000-8000-000000000001",
      "action": "entity.update",
      "resourceType": "entity",
      "resourceId": "019e42ae-9c00-7000-8000-000000000002",
      "payload": { "entity": { "name": "Ada Commanded" } },
      "reason": null,
      "createdAt": "2026-05-28T00:00:00.000Z",
      "schemaVersion": "0.1.0"
    }
  }'
```

Success response shape:

```json
{
  "accepted": true,
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "event": {
    "sequence": 2,
    "previousHash": "<previous event hash>",
    "payload": { "command": { "id": "019e42ae-9c00-7000-8000-000000000100" } }
  }
}
```

Invalid command bodies return `400` with `invalid_command_body`. Event-store append failures, such as stale chain-tip races, return `400` with `event_store_append_failed` plus the store error code/message.

## Current behavior

- Appends verified event-chain batches.
- Accepts typed command records and converts them into the next chain event.
- Rejects invalid command bodies and invalid/tampered/non-contiguous event batches without mutating stored events.
- Returns stored events by chain id.
- Projects stored events into graph state for entity, edge, identity, and diagnostic queries.
- Supports memory and SQLite event storage.
- Runs as a local development service via `pnpm --filter @sphere/node start`.
