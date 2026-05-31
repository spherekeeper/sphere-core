# Testing

Sphere Core uses layered tests to keep protocol primitives, event stores, graph projection, command handling, and the reference node aligned as the codebase evolves.

The current safety net is intentionally small but broad: package-level unit tests, shared event-store conformance tests, deterministic graph projection fixtures, and runtime smoke tests that exercise the HTTP node with memory and SQLite storage.

## Commands

From the repository root:

```bash
pnpm test
pnpm typecheck
git diff --check
```

Package-focused loops:

```bash
pnpm --filter @sphere/event-store test
pnpm --filter @sphere/graph test
pnpm --filter @sphere/commands test
pnpm --filter @sphere/node test
```

Before committing pushed work, run the full repository checks even if a package-focused loop passed.

## Test layers

### Protocol schemas and types

Location:

- `packages/types/test/types.test.ts`
- `packages/schemas/test/schemas.test.ts`

Purpose:

- ensure exported TypeScript protocol types stay usable;
- validate JSON Schema parsing for entities, identity links, edges, events, and commands;
- keep action-specific payload validation aligned with projection and command behavior.

### Event hashing and chain verification

Location:

- event-related package tests under `packages/`.

Purpose:

- enforce deterministic canonical serialization;
- verify event hashes;
- reject hash-chain mismatches;
- preserve the event-chain model that every store and projection layer depends on.

### Event-store conformance

Location:

- `packages/event-store/test/event-store.test.ts`

Purpose:

- run the same behavioral expectations against memory and SQLite implementations;
- prevent SQLite from drifting from the in-memory reference behavior;
- assert append atomicity and range-read semantics.

Current conformance expectations include:

- implementation metadata reports `memory` or `sqlite` correctly;
- empty stores return empty arrays and `undefined` tips;
- empty append batches are no-ops;
- appended chains are verified before insertion;
- event ids are globally unique;
- duplicate event ids reject atomically;
- mixed-chain batches reject atomically;
- candidate batches must continue from the stored chain tip;
- invalid, tampered, and non-contiguous chains do not persist partial events;
- `getEventsRange` uses exclusive `afterSequence` and positive optional `limit`;
- ranged reads after the chain tip return empty arrays;
- returned arrays are immutable snapshots from the caller's perspective.

When adding an event-store implementation, add it to the shared conformance matrix before writing implementation-specific tests.

### Graph projection unit and fixture tests

Location:

- `packages/graph/test/graph.test.ts`
- `specs/test-vectors/graph-projection/`

Purpose:

- verify replay of valid event chains into graph state;
- keep projection snapshots deterministic and language-neutral;
- document expected behavior for entities, edges, identity links, tombstones, and diagnostics.

The comprehensive fixture pair is:

- `specs/test-vectors/graph-projection/comprehensive-snapshot/events.json`
- `specs/test-vectors/graph-projection/comprehensive-snapshot/snapshot.json`

It covers:

- entity create, update, and delete;
- edge create and delete;
- identity link and unlink;
- a malformed-but-chain-valid event that is skipped with diagnostics;
- deterministic sorted snapshot collections;
- `appliedEventIds` and `skippedEventIds`;
- `lastAppliedEventId` and `lastReplayedEventId` replay cursors.

Use `snapshotGraphProjection` for fixture snapshots instead of hand-assembling ad hoc JSON. It sorts map-backed collections and returns plain JSON so snapshots are stable across runtimes.

### Command policy and submission tests

Location:

- `packages/commands/test/commands.test.ts`
- `apps/node/test/node.test.ts`

Purpose:

- verify helper-created commands use the correct action, resource type, resource id, and payload shape;
- verify `createCommandEvent` preserves projection payloads and embeds the source command for traceability;
- verify built-in command policy rejects inconsistent known commands before event creation;
- verify `custom:*` commands remain policy-open for app-specific handlers;
- verify node submission clients send JSON requests and surface non-2xx response details.

Policy details live in [Command Policy](./command-policy.md).

### Node HTTP behavior tests

Location:

- `apps/node/test/node.test.ts`

Purpose:

- exercise Fastify routes without starting a long-lived process;
- verify event append and command acceptance response shapes;
- verify graph query endpoints replay current chain state;
- verify auth-gated `/chains/*` behavior when the development bearer token is configured;
- verify invalid body, policy, range, and store errors are stable enough for clients.

### Node runtime smoke tests

Location:

- `apps/node/test/runtime.test.ts`

Purpose:

- exercise `createNodeRuntimeConfig`, process lifecycle helpers, and storage wiring;
- verify memory versus SQLite runtime metadata;
- verify SQLite persistence and replay across independent runtime instances.

The SQLite restart smoke test intentionally uses three independent runtime instances over the same file-backed SQLite database:

1. Instance one appends initial state.
2. Instance two restarts over the same DB and appends more state.
3. Instance three restarts again and verifies replay/read behavior.

This pattern catches bugs that a single-process test misses:

- sequence continuity across restarts;
- `previousHash` linkage across restarts;
- graph relationship replay from disk;
- reverse edge lookup replay;
- identity lookup replay;
- ranged event replay after restart;
- empty projection diagnostics.

## Projection fixture guidelines

When adding or updating graph fixtures:

1. Use deterministic ids and timestamps.
2. Keep event JSON and expected snapshot JSON as separate files.
3. Verify the fixture chain is hash-valid unless the test is explicitly about invalid-chain rejection.
4. Include chain-valid malformed payloads when testing projection diagnostics; the store should accept the event, and the projection should skip it.
5. Use sorted collections from `snapshotGraphProjection`.
6. Assert both applied and skipped event ids.
7. Assert replay cursor ids so incremental replay behavior is visible.
8. Prefer fixture names that describe the covered behavior, not implementation internals.

## Ranged API testing guidelines

When changing event reads, test both the store and node API layers:

- no range returns all events;
- `afterSequence` is exclusive;
- positive `limit` constrains result size;
- invalid `afterSequence` or `limit` returns a stable error at the HTTP layer;
- an empty page after the chain tip returns an empty event array;
- HTTP ranged responses include `pageInfo.afterSequence`, `pageInfo.limit`, `pageInfo.returned`, and `pageInfo.nextAfterSequence`.

## SQLite testing guidelines

When changing SQLite storage or runtime wiring:

- use temporary database files in tests;
- close stores/runtimes before reopening the same DB;
- assert behavior after reopening, not just before shutdown;
- check atomicity by reading the store after rejected appends;
- include duplicate-id and mixed-chain rejection cases in the shared conformance suite;
- avoid committing generated `.sqlite` files.

## Security and diff hygiene

Before pushing:

```bash
pnpm test
pnpm typecheck
git diff --check
```

Also scan added lines for obvious secret-like values. CI already performs this scan on pushed changes, but local review should catch accidents earlier.

The GitHub Actions workflow runs:

- install with pnpm 9.15.9 on Node.js 22;
- `pnpm test`;
- `pnpm typecheck`;
- `git diff --check` against the push or PR base;
- a lightweight added-line secret scan.

## When to add which test

- New protocol field: schema/type tests first, then package tests that consume the field.
- New event action: schema payload validation, graph projection behavior, command policy if commands can produce it, and node API coverage if exposed.
- New event-store implementation: shared conformance first, implementation-specific persistence tests second.
- New projection behavior: deterministic fixture plus focused unit test for edge cases.
- New node endpoint: route-level tests for success and stable errors, plus runtime smoke coverage if storage/lifecycle behavior changes.
- New app-specific command pattern: core policy docs plus app-level handler tests outside the core package once the app exists.
