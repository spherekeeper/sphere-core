# Reference Node API

This document describes the current HTTP contract for the Sphere reference node.

The reference node is a trusted-development runtime. It is suitable for local experiments, fixtures, and early app integration work. It is not a production network service yet; see [Runtime Security Boundary](./runtime-security-boundary.md).

## Base URL

Default local runtime:

```text
http://127.0.0.1:3080
```

Start the node from the repository root:

```bash
pnpm --filter @sphere/node start
```

See [Node Runtime](./node-runtime.md) for runtime configuration, storage modes, and restart expectations.

## Authentication

By default, the reference node does not require authentication.

If `SPHERE_NODE_BEARER_TOKEN` is configured, every `/chains/*` endpoint requires an `Authorization` header using the HTTP bearer-token scheme and the configured token value.

```bash
curl -s http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000000/events \
  -H 'authorization: Bearer TOKEN_VALUE'
```

The endpoint examples below omit this header for readability; add it to every `/chains/*` request when the bearer-token gate is enabled.

Unauthenticated endpoints even when the token is configured:

- `GET /health`
- `GET /node/info`

Unauthorized chain requests return:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{ "error": "unauthorized" }
```

The bearer token is a trusted-development gate only. It is not actor authorization. See [Authorization Roadmap](./authorization-roadmap.md) for the future caller/actor/chain authorization direction.

## Common conventions

- Request and response bodies are JSON.
- Path parameter `chainId` is the event chain id.
- Events are canonical history; graph responses are projections replayed from stored events.
- Write endpoints return `201` on success.
- Read endpoints return `200` on success, except missing single-resource projection lookups return `404`.
- Endpoint-level validation errors currently use `400`.
- Event-store append errors are surfaced as `event_store_append_failed` with an implementation-independent store error code and message.

## Endpoint summary

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

## `GET /health`

Health check for the local process.

### Response: `200`

```json
{
  "ok": true
}
```

## `GET /node/info`

Returns reference-node metadata.

### Response: `200`

```json
{
  "name": "sphere-reference-node",
  "schemaVersion": "0.1.0",
  "storage": "memory"
}
```

Fields:

- `name`: stable reference-node name.
- `schemaVersion`: current Sphere schema/protocol version.
- `storage`: active event-store backend, currently `memory` or `sqlite`.

## `POST /chains/:chainId/events`

Append an already-built batch of hash-linked events.

Use this endpoint for tests, fixtures, migrations, and low-level protocol work. For normal client writes, prefer `POST /chains/:chainId/commands` so the node derives sequence and previous-hash linkage.

### Request

```json
{
  "events": [
    {
      "id": "019e42ae-9c00-7000-8000-000000000010",
      "chainId": "019e42ae-9c00-7000-8000-000000000000",
      "sequence": 1,
      "actorId": "019e42ae-9c00-7000-8000-000000000001",
      "subjectId": "019e42ae-9c00-7000-8000-000000000002",
      "action": "entity.create",
      "resourceType": "entity",
      "resourceId": "019e42ae-9c00-7000-8000-000000000002",
      "timestamp": "2026-05-28T00:00:00.000Z",
      "payload": {
        "entity": {
          "id": "019e42ae-9c00-7000-8000-000000000002",
          "kind": "person",
          "name": "Ada Raver",
          "metadata": {},
          "createdAt": "2026-05-28T00:00:00.000Z",
          "updatedAt": "2026-05-28T00:00:00.000Z",
          "schemaVersion": "0.1.0"
        }
      },
      "reason": null,
      "schemaVersion": "0.1.0",
      "hashAlgorithm": "sha256",
      "previousHash": null,
      "hash": "<deterministic-sha256-event-hash>"
    }
  ]
}
```

### Response: `201`

```json
{
  "appended": 1,
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "latestSequence": 1
}
```

For an empty append batch, `appended` is `0` and `latestSequence` is the current chain tip sequence or `null` if the chain is empty.

### Errors

Invalid or missing body shape:

```http
HTTP/1.1 400 Bad Request

{ "error": "invalid_events_body" }
```

Any event whose embedded `chainId` does not match the URL chain id:

```http
HTTP/1.1 400 Bad Request

{
  "error": "chain_id_mismatch",
  "chainId": "019e42ae-9c00-7000-8000-000000000000"
}
```

Event-store append failure:

```http
HTTP/1.1 400 Bad Request

{
  "error": "event_store_append_failed",
  "code": "event_hash_mismatch",
  "message": "Cannot append invalid event chain: event_hash_mismatch at index 1"
}
```

Current append failure codes visible through this HTTP route include:

- `duplicate_event_id`: an event id was duplicated in the incoming batch or already exists in the store.
- `non_contiguous_append`: the first incoming event does not continue the stored chain tip.
- Chain verification codes from `verifyEventChain`, such as hash, previous-hash, sequence, or chain-id mismatches.

The underlying event store also has a `mixed_chain_id` error, but the HTTP route normally catches URL-vs-event chain mismatches first and returns endpoint-level `chain_id_mismatch`.

## `POST /chains/:chainId/commands`

Accept a typed command and append the generated event at the current chain tip.

The node derives:

- `chainId` from the URL;
- `sequence` from the latest stored event, or `1` for an empty chain;
- `previousHash` from the latest stored event hash, or `null` for an empty chain;
- event `hash` from canonical event serialization.

The generated event preserves projection payload fields and embeds the source command at `payload.command`.

### Request

```json
{
  "command": {
    "id": "019e42ae-9c00-7000-8000-000000000100",
    "actorId": "019e42ae-9c00-7000-8000-000000000001",
    "action": "entity.update",
    "resourceType": "entity",
    "resourceId": "019e42ae-9c00-7000-8000-000000000002",
    "payload": {
      "entity": {
        "name": "Ada Commanded",
        "metadata": { "role": "organizer" }
      }
    },
    "reason": null,
    "createdAt": "2026-05-28T00:00:00.000Z",
    "schemaVersion": "0.1.0"
  }
}
```

### Response: `201`

```json
{
  "accepted": true,
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "event": {
    "id": "019e42ae-9c00-7000-8000-000000000012",
    "chainId": "019e42ae-9c00-7000-8000-000000000000",
    "sequence": 2,
    "actorId": "019e42ae-9c00-7000-8000-000000000001",
    "subjectId": "019e42ae-9c00-7000-8000-000000000002",
    "action": "entity.update",
    "resourceType": "entity",
    "resourceId": "019e42ae-9c00-7000-8000-000000000002",
    "timestamp": "2026-05-28T00:00:00.000Z",
    "payload": {
      "entity": {
        "name": "Ada Commanded",
        "metadata": { "role": "organizer" }
      },
      "command": { "id": "019e42ae-9c00-7000-8000-000000000100" }
    },
    "reason": null,
    "schemaVersion": "0.1.0",
    "hashAlgorithm": "sha256",
    "previousHash": "<previous-event-hash>",
    "hash": "<deterministic-sha256-event-hash>"
  }
}
```

The response event includes the full command object at `payload.command`; the shortened object above is illustrative.

### Errors

Malformed request body or schema-invalid command:

```http
HTTP/1.1 400 Bad Request

{ "error": "invalid_command_body" }
```

Schema-valid command that fails built-in command policy:

```http
HTTP/1.1 400 Bad Request

{
  "error": "command_policy_failed",
  "errors": [
    {
      "code": "resource_id_mismatch",
      "path": "/resourceId",
      "message": "entity.create resourceId must match payload.entity.id"
    }
  ]
}
```

Append failure after event creation:

```http
HTTP/1.1 400 Bad Request

{
  "error": "event_store_append_failed",
  "code": "non_contiguous_append",
  "message": "Append does not continue stored chain 019e42ae-9c00-7000-8000-000000000000"
}
```

See [Command Policy](./command-policy.md) for policy details and the `custom:*` app boundary.

## `GET /chains/:chainId/events`

Read events for a chain.

### Query parameters

- `afterSequence`: optional non-negative integer. Exclusive cursor; only events with `sequence > afterSequence` are returned.
- `limit`: optional positive integer. Maximum number of events to return.

### Response without range query: `200`

```json
{
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "events": []
}
```

### Response with range query: `200`

```json
{
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "events": [
    { "sequence": 2, "id": "019e42ae-9c00-7000-8000-000000000011" }
  ],
  "pageInfo": {
    "afterSequence": 1,
    "limit": 100,
    "returned": 1,
    "nextAfterSequence": 2
  }
}
```

`pageInfo` appears whenever either `afterSequence` or `limit` is supplied.

Cursor rules:

- `afterSequence` in `pageInfo` is the requested cursor or `null`.
- `limit` in `pageInfo` is the requested limit or `null`.
- `returned` is the number of events in the page.
- `nextAfterSequence` is the last returned event sequence.
- If the page is empty, `nextAfterSequence` is the requested `afterSequence`, or `null` when only `limit` was supplied.

### Errors

Invalid range query:

```http
HTTP/1.1 400 Bad Request

{
  "error": "invalid_event_range",
  "message": "limit must be a positive integer"
}
```

## `GET /chains/:chainId/graph/entities`

Return all live projected entities for the chain.

Deleted/tombstoned entities are excluded. Entities are sorted by id.

### Response: `200`

```json
{
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "entities": [
    {
      "id": "019e42ae-9c00-7000-8000-000000000002",
      "kind": "person",
      "name": "Ada Raver",
      "metadata": {},
      "createdAt": "2026-05-28T00:00:00.000Z",
      "updatedAt": "2026-05-28T00:00:00.000Z",
      "schemaVersion": "0.1.0"
    }
  ]
}
```

## `GET /chains/:chainId/graph/entities/:entityId`

Return one live projected entity.

### Response: `200`

```json
{
  "id": "019e42ae-9c00-7000-8000-000000000002",
  "kind": "person",
  "name": "Ada Raver",
  "metadata": {},
  "createdAt": "2026-05-28T00:00:00.000Z",
  "updatedAt": "2026-05-28T00:00:00.000Z",
  "schemaVersion": "0.1.0"
}
```

### Error: `404`

```json
{
  "error": "entity_not_found",
  "id": "019e42ae-9c00-7000-8000-000000000002"
}
```

Tombstoned entities are treated as not found by this endpoint.

## `GET /chains/:chainId/graph/edges/from/:entityId`

Return non-deleted projected edges whose `sourceId` matches `entityId`.

### Response: `200`

```json
{
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "edges": [
    {
      "id": "019e42ae-9c00-7000-8000-000000000030",
      "sourceId": "019e42ae-9c00-7000-8000-000000000002",
      "targetId": "019e42ae-9c00-7000-8000-000000000003",
      "type": "trusts",
      "metadata": {},
      "createdAt": "2026-05-28T00:00:00.000Z",
      "createdBy": "019e42ae-9c00-7000-8000-000000000001",
      "schemaVersion": "0.1.0",
      "deletedAt": null,
      "deletedBy": null
    }
  ]
}
```

## `GET /chains/:chainId/graph/edges/to/:entityId`

Return non-deleted projected edges whose `targetId` matches `entityId`.

### Response: `200`

```json
{
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "edges": []
}
```

## `GET /chains/:chainId/graph/identity/:platform/:platformId`

Resolve one projected identity link by platform and platform-specific id.

### Response: `200`

```json
{
  "id": "019e42ae-9c00-7000-8000-000000000040",
  "entityId": "019e42ae-9c00-7000-8000-000000000002",
  "platform": "discord",
  "platformId": "1234567890",
  "handle": "ada",
  "verified": true,
  "metadata": {},
  "createdAt": "2026-05-28T00:00:00.000Z",
  "updatedAt": "2026-05-28T00:00:00.000Z",
  "schemaVersion": "0.1.0"
}
```

### Error: `404`

```json
{
  "error": "identity_link_not_found",
  "platform": "discord",
  "platformId": "1234567890"
}
```

## `GET /chains/:chainId/graph/diagnostics`

Return projection diagnostics recorded while replaying a chain.

Diagnostics report projection-level issues that do not necessarily make the event chain invalid. For example, a chain-valid event with malformed action payload can be skipped by projection while still remaining canonical history.

### Response: `200`

```json
{
  "chainId": "019e42ae-9c00-7000-8000-000000000000",
  "diagnostics": [
    {
      "code": "invalid_event_payload",
      "severity": "error",
      "eventId": "019e42ae-9c00-7000-8000-000000000099",
      "action": "entity.update",
      "message": "Invalid payload for event action entity.update: /payload/entity must be object",
      "resourceId": "019e42ae-9c00-7000-8000-000000000002"
    }
  ]
}
```

Current diagnostic codes include:

- `unsupported_action`
- `invalid_event_payload`
- `duplicate_event_skipped`
- `entity_update_missing_entity`
- `entity_update_tombstoned_entity`
- `edge_delete_missing_edge`
- `identity_unlink_missing_identity`

## Error catalog

Stable endpoint-level error values currently emitted by the reference node:

- `unauthorized`: missing or wrong bearer token for `/chains/*` when token auth is configured.
- `invalid_events_body`: `POST /events` body is missing an `events` array.
- `chain_id_mismatch`: at least one submitted event has a `chainId` different from the URL chain id.
- `event_store_append_failed`: event-store verification or append rejected the candidate batch.
- `invalid_command_body`: `POST /commands` body is missing a schema-valid command.
- `command_policy_failed`: command schema passed, but built-in command policy rejected it.
- `invalid_event_range`: event read query parameters are invalid.
- `entity_not_found`: projected live entity was not found.
- `identity_link_not_found`: projected identity link was not found.

## Contract status

This is the contract for the current reference node. It is stable enough for early clients and demos, but still pre-production. If an endpoint shape changes, update this document, `docs/node-runtime.md`, and route tests in `apps/node/test/node.test.ts` in the same change.
