# Node Runtime

The Sphere reference node is the local HTTP runtime for early Sphere Core experiments. It accepts verified event batches, accepts typed commands, stores events by chain, and replays each chain into a queryable graph projection.

It is intentionally a trusted-development service today. Do not expose it directly to untrusted networks. See [Runtime Security Boundary](./runtime-security-boundary.md) before remote or multi-user deployment.

## Quick start

Install dependencies from the repository root:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
```

Start the node with ephemeral memory storage:

```bash
pnpm --filter @sphere/node start
```

The default listener is `127.0.0.1:3080`. Check health and runtime metadata:

```bash
curl -s http://127.0.0.1:3080/health
curl -s http://127.0.0.1:3080/node/info
```

Expected metadata shape:

```json
{
  "name": "sphere-reference-node",
  "schemaVersion": "0.1.0",
  "storage": "memory"
}
```

## Runtime configuration

Configure the runtime with environment variables:

- `SPHERE_NODE_HOST`: listen host. Defaults to `127.0.0.1`.
- `SPHERE_NODE_PORT`: listen port. Defaults to `3080`. Must be an integer from `0` through `65535`.
- `SPHERE_NODE_DB`: optional SQLite database path. Omit or set to an empty value for memory storage.
- `SPHERE_NODE_BEARER_TOKEN`: optional trusted-development bearer token for `/chains/*` endpoints.

To bind beyond localhost for a trusted development deployment, set `SPHERE_NODE_HOST` explicitly (for example `0.0.0.0`) and put the node behind the network and transport protections described in [Runtime Security Boundary](./runtime-security-boundary.md).

Run on localhost with SQLite persistence:

```bash
SPHERE_NODE_HOST=127.0.0.1 \
SPHERE_NODE_PORT=3080 \
SPHERE_NODE_DB=./sphere-events.sqlite \
pnpm --filter @sphere/node start
```

Run with the development bearer-token gate enabled:

```bash
SPHERE_NODE_BEARER_TOKEN=TOKEN_VALUE pnpm --filter @sphere/node start
```

Then include a matching `authorization` header on chain endpoints. The header value uses the HTTP bearer-token scheme with the token configured in `SPHERE_NODE_BEARER_TOKEN`.

```bash
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/events \
  -H 'authorization: Bearer ***'
```

The endpoint examples below omit the header for readability. If the bearer-token gate is enabled, add the same `authorization` header to every `/chains/*` request.

`/health` and `/node/info` remain unauthenticated even when the bearer token is configured.

## Storage modes

### Memory storage

Memory storage is the default. It is useful for unit tests, demos, and short local sessions.

Behavior:

- creates an empty event store for each runtime process;
- loses all chain state when the process exits;
- reports `storage: "memory"` from `/node/info`;
- shares the same append and read invariants as SQLite through the event-store conformance suite.

### SQLite storage

SQLite storage is enabled by setting `SPHERE_NODE_DB` to a file path.

Behavior:

- creates tables and indexes on startup;
- persists complete event JSON by `chainId` and `sequence`;
- verifies candidate event chains before insertion;
- inserts batches transactionally;
- rejects invalid, tampered, non-contiguous, duplicate-id, or mixed-chain batches without partial writes;
- replays graph projections from disk after restart;
- reports `storage: "sqlite"` from `/node/info`.

The runtime closes Fastify and closeable event stores during `SIGINT` and `SIGTERM` shutdown.

## Restart and persistence expectations

With memory storage, restart means a new empty node.

With SQLite storage, restart means the new runtime instance reuses the same event file:

1. The next accepted command continues from the stored chain tip.
2. The generated event sequence is previous sequence plus one.
3. The generated `previousHash` is the previous event hash.
4. Graph queries replay stored events from disk.
5. Forward and reverse edge lookups replay the same relationship state.
6. Identity lookups replay by `platform` and `platformId`.
7. Ranged event reads still work after restart.
8. Empty chains return empty projection diagnostics.

This pattern is covered by the node runtime SQLite restart smoke test in `apps/node/test/runtime.test.ts`.

## API surface

The full endpoint contract, including request/response shapes and the error catalog, lives in [Reference Node API](./api.md).

Public runtime endpoints:

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

All `/chains/*` endpoints require an `authorization` header containing the configured bearer token when the runtime is started with `SPHERE_NODE_BEARER_TOKEN`.

### Append verified events

Use this when a client has already constructed hash-linked events:

```bash
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/events \
  -H 'content-type: application/json' \
  -d '{ "events": [] }'
```

Response shape:

```json
{
  "appended": 0,
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "latestSequence": null
}
```

Invalid request bodies return `400` with `invalid_events_body`. Events whose embedded `chainId` does not match the URL return `400` with `chain_id_mismatch`. Store verification failures return `400` with `event_store_append_failed`, plus the store error code and message.

### Accept a command

Use this when the client wants the node to derive the next event sequence and previous hash from the stored chain tip:

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

Response shape:

```json
{
  "accepted": true,
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "event": {
    "sequence": 2,
    "previousHash": "<previous event hash>"
  }
}
```

Invalid command bodies return `400` with `invalid_command_body`. Commands that are schema-valid but fail built-in policy return `400` with `command_policy_failed` and policy errors. Append races or store verification failures return `400` with `event_store_append_failed`.

See [Command Policy](./command-policy.md) for built-in and app-specific command boundaries. See [Events and Actions](./events-and-actions.md) for event payload and projection semantics.

### Read events

Fetch all events for a chain:

```bash
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/events
```

Fetch a ranged page:

```bash
curl -s 'http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/events?afterSequence=10&limit=100'
```

Range semantics:

- `afterSequence` is exclusive.
- `limit` must be a positive integer when supplied.
- Ranged responses include `pageInfo`.
- `pageInfo.nextAfterSequence` is the cursor for the next request.
- Empty ranged pages keep `nextAfterSequence` at the requested `afterSequence`, or `null` when only `limit` was supplied.
- Invalid query parameters return `400` with `invalid_event_range`.

### Query graph projections

The node replays the stored event chain on graph-query endpoints and returns current projection state.

List live entities:

```bash
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/graph/entities
```

Read one live entity:

```bash
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/graph/entities/019e42ae-9c00-7000-8000-000000000002
```

Read outgoing and incoming edges:

```bash
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/graph/edges/from/019e42ae-9c00-7000-8000-000000000002
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/graph/edges/to/019e42ae-9c00-7000-8000-000000000002
```

Resolve an identity link:

```bash
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/graph/identity/discord/1234567890
```

Read projection diagnostics:

```bash
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/graph/diagnostics
```

Entity and identity single-resource lookups return `404` with `entity_not_found` or `identity_link_not_found` when no projected record exists.

## Related docs

- [Reference Node API](./api.md)
- [Events and Actions](./events-and-actions.md)
- [Command Policy](./command-policy.md)
- [Authorization Roadmap](./authorization-roadmap.md)
- [Runtime Security Boundary](./runtime-security-boundary.md)

## Operational notes

- Treat chain ids and event ids as protocol ids, not database row ids.
- Prefer command submission for normal clients. It lets the node own chain-tip sequencing.
- Prefer direct event submission for tests, fixtures, migration imports, and low-level protocol validation.
- Keep SQLite files out of git unless they are deliberate fixtures.
- Use deterministic ids and timestamps in tests and docs snippets.
- Re-run `pnpm --filter @sphere/node test`, `pnpm test`, and `pnpm typecheck` after changing runtime behavior.
