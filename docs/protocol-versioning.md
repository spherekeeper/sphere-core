# Protocol and schema versioning

Sphere core is currently on draft protocol version `0.1.0`.

The protocol version and JSON Schema version are intentionally the same value during the draft phase. Code should use the exported constants instead of hard-coding version strings:

- `SPHERE_PROTOCOL_VERSION` — current protocol version.
- `SPHERE_SCHEMA_VERSION` — alias for the current schema version used on records.
- `SPHERE_SUPPORTED_SCHEMA_VERSIONS` — versions accepted by this implementation.
- `isSupportedSchemaVersion(value)` — runtime guard for unknown inputs.

These exports live in `@sphere/types` and are re-exported by `@sphere/schemas` for validation callers.

## Record rule

Every versioned Sphere record must include `schemaVersion` and, for the current implementation, that value must be exactly `0.1.0`.

The JSON Schemas enforce this with a `const` on `schemaVersion`; validators reject future or older versions until explicit compatibility support is added.

## Schema ID rule

Every JSON Schema `$id` includes the draft version path:

```text
https://sphere.dev/schemas/draft/0.1.0/<name>.schema.json
```

When the protocol version changes, update all schema `$id` values and `schemaVersion.const` values together, then update the exported version constants.

## Compatibility policy while draft

Until a stable protocol version is declared:

1. Treat version changes as breaking by default.
2. Do not accept multiple schema versions silently.
3. Add explicit tests before adding compatibility for an older version.
4. Keep examples and test vectors on the current version unless a fixture is specifically documenting migration behavior.
5. Prefer additive metadata under `payload`/`metadata` for experiments that should not require a version bump.

## Migration checklist for a future version bump

1. Add a failing test that describes the intended version behavior.
2. Update `SPHERE_PROTOCOL_VERSION`, `SPHERE_SCHEMA_VERSION`, and `SPHERE_SUPPORTED_SCHEMA_VERSIONS` deliberately.
3. Update all `specs/schemas/*.schema.json` `$id` and `schemaVersion.const` values.
4. Update examples and test vectors or add migration-specific fixtures.
5. Decide whether validators reject, accept, or migrate prior versions.
6. Document the compatibility decision in this file.
7. Run full verification: `pnpm test`, `pnpm typecheck`, `git diff --check`, and CI.
