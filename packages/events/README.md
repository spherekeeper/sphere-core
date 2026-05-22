# @sphere/events

Canonical serialization helpers for Sphere protocol values and events.

## Current scope

This package currently defines deterministic serialization only:

- `canonicalJson(value, options?)`
- `canonicalXml(value, options?)`
- `eventToCanonicalJson(event, options?)`
- `eventToCanonicalXml(event, options?)`

Hashing and hash-chain verification will build on top of these helpers in later commits.

## Canonical JSON rules

- Objects are serialized with lexicographically sorted keys.
- Arrays preserve order.
- Strings, booleans, finite numbers, and `null` are allowed.
- `Date` objects are serialized as ISO strings.
- `undefined`, symbols, functions, bigint, and non-finite numbers are rejected.
- Optional `omitKeys` can remove object properties at every object level before serialization.

## Canonical XML rules

- Objects become nested elements with lexicographically sorted keys.
- Arrays become repeated `<item>` children under the array element.
- `null` becomes a self-closing element with `null="true"`.
- Text values escape XML special characters: `&`, `<`, `>`, `"`, and `'`.
- XML element names must match `/^[A-Za-z_][A-Za-z0-9._-]*$/`.

## Open decision

The XML form is intended as a deterministic interchange/debug representation, not as the primary wire format. JSON remains the primary protocol serialization unless a later ADR changes that.
