# @sphere/commands

Command-to-event helpers plus reference-node client utilities for Sphere.

This package is the first ergonomic layer above raw events. It builds typed `Command` records for common graph mutations, converts those commands into hash-linked events, submits commands or event batches to a Sphere reference node, and reads back health/runtime/event/graph responses from the current HTTP API.

## Supported command helpers

- `createEntityCreateCommand({ actorId, entity })`
- `createEntityUpdateCommand({ actorId, entityId, patch })`
- `createIdentityLinkCommand({ actorId, identityLink })`
- `createEdgeCreateCommand({ actorId, edge })`

All helpers accept optional:

- `now`: deterministic timestamp source for tests/fixtures
- `createId`: deterministic ID factory for tests/fixtures
- `reason`: optional human-readable reason

## Creating events from commands

```ts
import {
  createCommandEvent,
  createEntityCreateCommand,
} from '@sphere/commands';

const command = createEntityCreateCommand({ actorId, entity });
const event = createCommandEvent({
  command,
  chainId,
  sequence: 1,
});
```

To append after an existing event, pass `previousEvent`; the helper copies its hash into the new event and recomputes the new event hash.

```ts
const nextEvent = createCommandEvent({
  command: updateCommand,
  chainId,
  sequence: previousEvent.sequence + 1,
  previousEvent,
});
```

Generated event payloads preserve the projection contract (`payload.entity`, `payload.identityLink`, or `payload.edge`) and also include the source `payload.command` for traceability.

Before creating an event, `createCommandEvent` enforces the built-in command policy for known actions and throws `CommandPolicyError` if the command is internally inconsistent.

## Command policy validation

Use `validateCommandPolicy(command)` when accepting untrusted or hand-built commands. It returns `{ ok: true }` or `{ ok: false, errors }` with stable error codes and JSON-style paths.

The full policy and app-specific handler boundary are documented in [`docs/command-policy.md`](../../docs/command-policy.md).

Current built-in policy checks for known actions:

- `entity.create`, `entity.update`, `entity.delete` must use `resourceType: "entity"`.
- `identity.link`, `identity.unlink` must use `resourceType: "identity_link"`.
- `edge.create`, `edge.delete` must use `resourceType: "edge"`.
- create/link commands must include the expected payload object and its `id` must match `resourceId`.
- update/delete/unlink commands must include a non-empty `resourceId`; update commands must include the expected patch object.
- non-`custom:*` actions outside the built-in command set are rejected with `unsupported_action`.

`custom:*` commands are policy-open so app-specific handlers can define their own contracts without forking the core package.

## Submitting to a node

Submit commands directly when you want the node to derive the next sequence number and previous hash from the current chain tip:

```ts
import { createCommandSubmissionClient } from '@sphere/commands';

const client = createCommandSubmissionClient({
  baseUrl: 'http://127.0.0.1:3080',
  // Optional: include this when the node is started with SPHERE_NODE_BEARER_TOKEN.
  bearerToken: 'your-secret',
});
const result = await client.submitCommand({ chainId, command });

console.log(result.event.sequence);
```

You can also submit already-built event batches:

```ts
await client.submitEvents({ chainId, events: [event] });
```

## Reading from a node

Use `createNodeReadClient` when a client wants typed wrappers around the current reference-node read endpoints:

```ts
import { createNodeReadClient } from '@sphere/commands';

const readClient = createNodeReadClient({
  baseUrl: 'http://127.0.0.1:3080',
  // Optional: include this when the node is started with SPHERE_NODE_BEARER_TOKEN.
  bearerToken: 'your-secret',
});

const info = await readClient.getNodeInfo();
const entities = await readClient.listEntities({ chainId });
const events = await readClient.getEvents({ chainId, afterSequence: 10, limit: 100 });
```

Current read helpers cover:

- `getHealth()`
- `getNodeInfo()`
- `getEvents({ chainId, afterSequence?, limit? })`
- `listEntities({ chainId })`
- `getEntity({ chainId, entityId })`
- `getEdgesFrom({ chainId, entityId })`
- `getEdgesTo({ chainId, entityId })`
- `getIdentityLink({ chainId, platform, platformId })`
- `getDiagnostics({ chainId })`

Non-2xx responses also throw `CommandSubmissionError` with `status` and parsed `details` so callers can inspect route-level error bodies.

## Node command endpoint

The reference node also accepts commands directly:

```http
POST /chains/:chainId/commands
Content-Type: application/json

{ "command": { /* Command */ } }
```

The node derives the next sequence/previous hash from the chain tip, converts the command to an event with `createCommandEvent`, appends it, and returns `{ accepted, chainId, event }`. Because commands are intent-level records, clients do not provide sequence numbers or previous hashes on this endpoint.

`client.submitCommand({ chainId, command })` wraps this endpoint and returns the same response shape.

The reference node is local/trusted-development software today. By default, the command endpoint has no authentication or rate limiting. If the node is started with `SPHERE_NODE_BEARER_TOKEN`, pass the same value as `bearerToken` so the client sends a matching bearer `Authorization` header.
