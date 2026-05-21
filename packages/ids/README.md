# @sphere/ids

UUIDv7-compatible identifier helpers for Sphere protocol objects.

## Exports

- `createId(options?)` — generate a lowercase UUIDv7-compatible Sphere ID.
- `isId(value)` — validate that a value is a lowercase UUIDv7-compatible Sphere ID.
- `assertId(value, label?)` — throw if a value is not valid.
- `parseIdTimestamp(id)` — recover the millisecond timestamp encoded in a valid UUIDv7 ID.
- `compareIds(left, right)` — lexicographic compare for valid IDs.

## Current decision

Sphere IDs are currently plain lowercase UUIDv7-compatible strings. This keeps IDs sortable by creation time and interoperable with standard tooling while leaving room for future DID/content-addressed identifiers at higher layers.
