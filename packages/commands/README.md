# @sphere/commands

Command-to-event helpers and node submission utilities for Sphere.

This package is the first ergonomic layer above raw events. It builds typed `Command` records for common graph mutations, converts those commands into hash-linked events, and submits event batches to a Sphere reference node.

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

## Submitting to a node

```ts
import { createCommandSubmissionClient } from '@sphere/commands';

const client = createCommandSubmissionClient({ baseUrl: 'http://127.0.0.1:3080' });
await client.submitEvents({ chainId, events: [event] });
```

Non-2xx node responses throw `CommandSubmissionError` with `status` and parsed `details`.

## Node command endpoint

The reference node also accepts commands directly:

```http
POST /chains/:chainId/commands
Content-Type: application/json

{ "command": { /* Command */ } }
```

The node derives the next sequence/previous hash from the chain tip, converts the command to an event with `createCommandEvent`, appends it, and returns `{ accepted, chainId, event }`.
