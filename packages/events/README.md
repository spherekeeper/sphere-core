# @sphere/events

Canonical serialization helpers for Sphere protocol values and events.

This is currently a workspace/source package in the `sphere-core` monorepo. It is not published to npm yet.

## Current scope

This package currently defines deterministic serialization only:

- `canonicalJson(value, options?)`
- `canonicalXml(value, options?)`
- `eventToCanonicalJson(event, options?)`
- `eventToCanonicalXml(event, options?)`
- `eventHashPayloadJson(event)`
- `computeEventHash(event)`
- `withEventHash(event)`
- `verifyEventHash(event)`
- `linkEvent(previousEvent, nextEvent)`
- `verifyEventChain(events)`

Hash-chain verification is available for ordered event streams.

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

## Event hash rules

- Event hashes use SHA-256 over canonical JSON.
- The top-level `hash` field is excluded from the hash input.
- Nested `hash` fields inside `payload` or other child objects are preserved.
- Hashes are encoded as lowercase hexadecimal strings without an algorithm prefix.
- The event should set `hashAlgorithm` to `sha256`.

## Hash-chain rules

- A chain is a non-empty ordered event stream.
- The genesis event must have `previousHash: null`.
- Every event must have a valid event hash.
- Every non-genesis event must use the same `chainId` as the previous event.
- Every non-genesis event must increment `sequence` by exactly one.
- Every non-genesis event must set `previousHash` to the previous event's `hash`.
- `verifyEventChain(events)` returns a structured error code instead of throwing.
