# Graph projection test vectors

Fixtures for replaying verified event chains into graph projection state.

- `entity-edge-update-delete-chain.json`: creates an entity, updates it, creates an edge, tombstones the edge, then tombstones the entity.
- `identity-link-unlink-chain.json`: links a Discord identity to an entity, then unlinks it.
- `comprehensive-snapshot/events.json`: a verified chain covering entity create/update/delete, edge create/delete, identity link/unlink, and a malformed-but-chain-valid skipped event.
- `comprehensive-snapshot/snapshot.json`: the deterministic plain JSON `snapshotGraphProjection` result expected after replaying `comprehensive-snapshot/events.json`.
