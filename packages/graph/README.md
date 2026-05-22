# @sphere/graph

In-memory Sphere graph projection helpers.

This package replays verified event chains into queryable entity and edge maps.

The current projection supports:

- `entity.create`
- `entity.update`
- `entity.delete`
- `edge.create`
- `edge.delete`
- `identity.link`
- `identity.unlink`
- `getEntity(id)`
- `getEntityTombstone(id)`
- `getEdge(id)`
- `getEdgesFrom(sourceId)`
- `getEdgesTo(targetId)`
- `getIdentityLink(id)`
- `getIdentityLinksForEntity(entityId)`
- `getIdentityLinkByPlatform(platform, platformId)`
- `getProjectionDiagnostics(graph)`

Deletion semantics:

- `entity.delete` records an entity tombstone and hides the entity from active lookup.
- `edge.delete` marks an edge with `deletedAt` and `deletedBy`.
- Directional edge queries exclude deleted edges.

Diagnostics semantics:

- Unsupported event actions are recorded as `info` diagnostics.
- Malformed action-specific payloads are recorded as `error` diagnostics and skipped before projection state is mutated.
- Missing update/delete targets are recorded as `warning` diagnostics.
- Diagnostics include event id, action, code, message, and resource id when applicable.
