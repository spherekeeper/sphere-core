# @sphere/graph

In-memory Sphere graph projection helpers.

This package replays verified event chains into queryable entity and edge maps.

The current projection supports:

- `entity.create`
- `entity.update`
- `entity.delete`
- `edge.create`
- `edge.delete`
- `getEntity(id)`
- `getEntityTombstone(id)`
- `getEdge(id)`
- `getEdgesFrom(sourceId)`
- `getEdgesTo(targetId)`

Deletion semantics:

- `entity.delete` records an entity tombstone and hides the entity from active lookup.
- `edge.delete` marks an edge with `deletedAt` and `deletedBy`.
- Directional edge queries exclude deleted edges.
