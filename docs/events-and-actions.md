# Events and Actions

Sphere Core is event-sourced: events are canonical history, and graph state is a projection of that history.

This document describes the current event envelope, supported action semantics, projection behavior, and how commands become events in the reference node.

## Event model

An event records an accepted fact in a chain.

Required event fields:

- `id`: unique event id.
- `chainId`: chain this event belongs to.
- `sequence`: integer position in the chain, starting at `1`.
- `actorId`: actor responsible for the event.
- `subjectId`: primary subject of the event, or `null`.
- `action`: event action, such as `entity.create` or `edge.delete`.
- `resourceType`: resource family affected by the event.
- `resourceId`: id of the affected resource, or `null`.
- `timestamp`: event timestamp as an ISO date-time string.
- `payload`: action-specific JSON object.
- `reason`: optional human-readable reason, or `null`.
- `schemaVersion`: current schema version, currently `0.1.0`.
- `hashAlgorithm`: currently `sha256`.
- `previousHash`: previous event hash, or `null` for the first event in a chain.
- `hash`: deterministic hash of the event.

Example event:

```json
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
```

## Chain rules

Event stores verify candidate chains before appending them.

Current chain invariants:

- events in a single append batch must all share the same `chainId`;
- event ids must be globally unique in the store;
- event ids must not repeat within a batch;
- the first event in an empty chain has `sequence: 1` and `previousHash: null`;
- each next event increments sequence by one;
- each next event's `previousHash` matches the prior event's `hash`;
- each event hash verifies against its canonical serialized content;
- when appending to a non-empty stored chain, the first incoming event must continue the stored tip.

Rejected appends are atomic: invalid batches do not persist partial events.

## Resource records

### Entity

Entity records represent people, agents, groups, apps, nodes, or generic resources.

Fields:

- `id`
- `kind`: one of `person`, `agent`, `group`, `app`, `node`, `resource`.
- `name`
- `metadata`
- `createdAt`
- `updatedAt`
- `schemaVersion`

### Edge

Edge records represent relationships between entities or resources.

Fields:

- `id`
- `sourceId`
- `targetId`
- `type`: one of the built-in edge types or a `custom:*` type.
- `metadata`
- `createdAt`
- `createdBy`
- `deletedAt`, optional or `null`.
- `deletedBy`, optional or `null`.
- `schemaVersion`

Current built-in edge types:

- `trusts`
- `vouches_for`
- `endorses`
- `blocks`
- `member_of`
- `admin_of`
- `moderates`
- `owns`
- `founded`
- `contains`
- `parent_of`
- `represents`
- `delegates_to`
- `hosted_by`

### Identity link

Identity links connect a Sphere entity to an external platform identity.

Fields:

- `id`
- `entityId`
- `platform`
- `platformId`
- `handle`, string or `null`.
- `verified`, boolean.
- `metadata`
- `createdAt`
- `updatedAt`
- `schemaVersion`

## Supported event actions

The event schema accepts action strings that look like `namespace.verb` or `custom:*`. The graph projection currently has explicit handlers for these actions:

- `entity.create`
- `entity.update`
- `entity.delete`
- `edge.create`
- `edge.delete`
- `identity.link`
- `identity.unlink`

The TypeScript event type also includes `command.accept` and `command.reject`, but the current graph projection treats them like unsupported actions unless a future handler is added.

Custom actions are schema-valid when they use the `custom:` prefix. They are canonical events but do not affect the core graph projection unless a projection handler exists.

## Action reference

### `entity.create`

Creates or replaces a projected entity.

Recommended envelope:

- `resourceType`: `entity`
- `resourceId`: entity id
- `subjectId`: usually the entity id
- `payload.entity`: entity object

Projection behavior:

- stores the entity by `payload.entity.id`, falling back to `resourceId`;
- fills missing `kind`, `name`, `createdAt`, and `updatedAt` from event defaults when possible;
- clears any existing tombstone for the same entity id;
- records the event id in `appliedEventIds`.

Minimal payload shape:

```json
{
  "entity": {
    "id": "019e42ae-9c00-7000-8000-000000000002",
    "kind": "person",
    "name": "Ada Raver",
    "metadata": {},
    "createdAt": "2026-05-28T00:00:00.000Z",
    "updatedAt": "2026-05-28T00:00:00.000Z",
    "schemaVersion": "0.1.0"
  }
}
```

### `entity.update`

Updates an existing live projected entity.

Expected envelope:

- `resourceType`: `entity`
- `resourceId`: entity id
- `payload.entity`: patch object

Projection behavior:

- looks up the entity by `resourceId`, falling back to `subjectId`;
- updates `kind` when the patch includes a string `kind`;
- updates `name` when the patch includes a string `name`;
- merges `metadata` into existing metadata;
- sets `updatedAt` to `payload.entity.updatedAt` or the event timestamp;
- adds `entity_update_missing_entity` when the entity does not exist;
- adds `entity_update_tombstoned_entity` when the entity was deleted.

Patch example:

```json
{
  "entity": {
    "name": "Ada Updated",
    "metadata": { "role": "organizer" }
  }
}
```

### `entity.delete`

Tombstones an entity.

Expected envelope:

- `resourceType`: `entity`
- `resourceId`: entity id
- `payload`: can be an empty object

Projection behavior:

- records a tombstone containing id, deletion timestamp, deleting actor, event id, and reason;
- live entity lookups return not found for tombstoned entities;
- `GET /graph/entities` excludes tombstoned entities;
- the original entity record can remain in projection internals but is not exposed as live.

### `edge.create`

Creates or replaces a projected edge.

Recommended envelope:

- `resourceType`: `edge`
- `resourceId`: edge id
- `subjectId`: optional related subject id; command-created edge events currently infer it from `payload.edge.targetId`
- `payload.edge`: edge object

Projection behavior:

- stores the edge by `payload.edge.id`, falling back to `resourceId` when the resource type is `edge`, then the event id;
- uses `payload.edge.sourceId` and `payload.edge.targetId` when present, with fallback values from the event envelope;
- fills missing `type`, timestamps, creator, deletion fields, and schema version from defaults when possible;
- active edge queries return edges where `deletedAt` is `null` or absent.

Minimal payload shape:

```json
{
  "edge": {
    "id": "019e42ae-9c00-7000-8000-000000000030",
    "sourceId": "019e42ae-9c00-7000-8000-000000000002",
    "targetId": "019e42ae-9c00-7000-8000-000000000003",
    "type": "trusts",
    "metadata": {},
    "createdAt": "2026-05-28T00:00:00.000Z",
    "createdBy": "019e42ae-9c00-7000-8000-000000000001",
    "deletedAt": null,
    "deletedBy": null,
    "schemaVersion": "0.1.0"
  }
}
```

### `edge.delete`

Marks an existing edge as deleted.

Expected envelope:

- `resourceType`: `edge`
- `resourceId`: edge id
- `payload`: can be an empty object

Projection behavior:

- finds the current edge by `resourceId`;
- sets `deletedAt` to the event timestamp;
- sets `deletedBy` to the event actor id;
- active edge queries exclude the deleted edge;
- adds `edge_delete_missing_edge` when the edge does not exist.

### `identity.link`

Creates or replaces an identity link.

Expected envelope:

- `resourceType`: `identity_link`
- `resourceId`: identity link id
- `subjectId`: entity id
- `payload.identityLink`: full identity link object

Projection behavior:

- stores the identity link by id;
- indexes it by entity id;
- indexes it by `platform:platformId`;
- if the same link id already exists, removes old identity indexes before adding the new indexes.

Minimal payload shape:

```json
{
  "identityLink": {
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
}
```

The projection also accepts legacy payload key `identity_link` when replaying identity-link events.

### `identity.unlink`

Removes an identity link from the projection indexes.

Expected envelope:

- `resourceType`: `identity_link`
- `resourceId`: identity link id
- `payload`: can be an empty object

Projection behavior:

- finds the identity link by `resourceId`;
- removes it from the link map;
- removes the entity-id and platform indexes;
- adds `identity_unlink_missing_identity` when the link does not exist.

## Projection diagnostics

Projection diagnostics are not event-store append errors. They are replay-time notes about events that are chain-valid but cannot be applied cleanly to the current projection.

Current diagnostics:

- `unsupported_action`: no core projection handler exists for the event action.
- `invalid_event_payload`: action-specific payload validation failed; the event is skipped.
- `duplicate_event_skipped`: replay saw an event id that was already applied or skipped.
- `entity_update_missing_entity`: update targeted an entity not present in the projection.
- `entity_update_tombstoned_entity`: update targeted a tombstoned entity.
- `edge_delete_missing_edge`: delete targeted a missing edge.
- `identity_unlink_missing_identity`: unlink targeted a missing identity link.

Invalid action payloads are skipped and added to `skippedEventIds`. Unsupported actions currently add an `unsupported_action` diagnostic but are still recorded in `appliedEventIds` because replay processed the event envelope.

## Deterministic snapshots

Use `snapshotGraphProjection` when documenting or testing expected graph state.

Snapshot fields:

- `entities`: sorted by id.
- `entityTombstones`: sorted by id.
- `edges`: sorted by id.
- `identityLinks`: sorted by id.
- `diagnostics`: replay diagnostics in encounter order.
- `appliedEventIds`: applied events in replay order.
- `skippedEventIds`: skipped events in replay order.
- `lastAppliedEventId`: last event that changed or was accepted by projection.
- `lastReplayedEventId`: last event replay attempted, including skipped invalid-payload events.

Canonical fixture location:

```text
specs/test-vectors/graph-projection/comprehensive-snapshot/
```

## Commands as event sources

Commands are not canonical chain history until accepted and converted to events.

When the reference node accepts a command through `POST /chains/:chainId/commands`, it creates an event with:

- `chainId` from the URL;
- `sequence` as `1` for an empty chain or latest stored sequence plus one;
- `previousHash` from the stored chain tip, or `null` for an empty chain;
- `actorId`, `action`, `resourceType`, `resourceId`, and `reason` copied from the command;
- `subjectId` inferred from the command payload when possible;
- projection payload fields preserved;
- the full source command embedded at `payload.command`.

Example: an `entity.update` command becomes an `entity.update` event with both `payload.entity` and `payload.command`.

See [Command Policy](./command-policy.md) for command validation and app-specific `custom:*` command boundaries.

## Custom and future actions

Use `custom:*` for app-specific actions that are not yet Sphere Core protocol actions.

Guidelines:

- Keep app-specific business rules outside `@sphere/commands` unless they become protocol-generic.
- Add app-owned schemas and authorization before accepting custom commands into history.
- Add projection handlers deliberately when custom events need app query models.
- Promote a custom action into core only with schema, policy, projection behavior, tests, fixtures, and docs.

For the festival/rave planner candidate, likely app-owned custom actions include RSVP, invitation, organizer approval, and safety-review flows. Those should remain app-specific until their semantics are proven reusable across Sphere apps.

## Related docs

- [Reference Node API](./api.md)
- [Node Runtime](./node-runtime.md)
- [Command Policy](./command-policy.md)
- [Testing](./testing.md)
- [Protocol Versioning](./protocol-versioning.md)
