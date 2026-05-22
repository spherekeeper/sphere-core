# Valid Test Vectors

Protocol fixtures that should pass validation or match deterministic helper output.

## ID vectors

- `id-uuidv7-zero-random.json` — deterministic UUIDv7-compatible ID generated with zeroed random bytes.

## Serialization vectors

- `canonical-json-basic.txt` — canonical JSON serialization of a nested unordered object.
- `canonical-xml-basic.xml` — canonical XML serialization of the same nested unordered object.
- `event-hash-basic-input.json` — canonical JSON hash input for a deterministic event fixture, excluding only the top-level `hash` field.
- `event-hash-basic.sha256` — SHA-256 hash of `event-hash-basic-input.json`.
