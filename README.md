# Sphere Core

[![CI](https://github.com/spherekeeper/sphere-core/actions/workflows/ci.yml/badge.svg)](https://github.com/spherekeeper/sphere-core/actions/workflows/ci.yml)

Sphere core protocol schemas, TypeScript reference packages, and an early reference node/runtime.

This repo exists to extract and stabilize the proven graph, identity, event, and adapter lessons from earlier Sphere prototypes so they can be reused by real applications.

## Current goal

Build the smallest useful Sphere core that can:

- define language-agnostic schemas for entities, identity links, edges, events, and commands;
- provide TypeScript reference types and validators;
- produce deterministic event hashes and verify event chains;
- replay events into queryable graph projections;
- expose a minimal local reference node;
- define adapter contracts informed by the legacy Discord integration.

## Architecture thesis

Events are canonical history. Graph state is a projection. Platform integrations, such as Discord roles and channels, are adapter projections rather than Sphere protocol concepts.

## Initial structure

```text
specs/       Draft protocol specs, JSON Schemas, examples, and test vectors.
packages/    Reusable TypeScript packages close to protocol semantics.
apps/        Temporary reference node and CLI until split-worthy.
references/  Legacy implementation notes and migration maps.
docs/        Development and architecture notes for this repo.
```

## Legacy source material

The current implementation plan is based on earlier Sphere prototypes:

- a legacy Discord bot/runtime;
- an earlier graph-service prototype;
- an earlier web-app prototype.

See [`references/legacy-sources.md`](references/legacy-sources.md) for the extraction stance. Do not copy old systems wholesale; extract concepts, tests, and migration fixtures deliberately.

## Development

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm test
pnpm typecheck
```

## Distribution status

- Early applications can integrate these components today, primarily by source/workspace consumption inside a monorepo or direct repository checkout.
- The packages are still workspace/source packages today; npm publishing and semver release workflow are not set up yet.
- `apps/node` and `apps/demo` are reference implementations, not production services.

## Documentation

- [Architecture](docs/architecture.md)
- [Reference Node API](docs/api.md)
- [Events and Actions](docs/events-and-actions.md)
- [Demo CLI](apps/demo/README.md)
- [Node Runtime](docs/node-runtime.md)
- [Testing](docs/testing.md)
- [Command Policy](docs/command-policy.md)
- [Authorization Roadmap](docs/authorization-roadmap.md)
- [Runtime Security Boundary](docs/runtime-security-boundary.md)
- [Protocol Versioning](docs/protocol-versioning.md)

## Status

The first kernel is implemented and test-covered:

- protocol types and JSON Schemas;
- runtime schema and action-payload validation;
- UUIDv7-compatible ID helpers;
- canonical JSON/XML serialization;
- deterministic SHA-256 event hashing;
- event hash-chain verification;
- replayable in-memory graph projection;
- in-memory and SQLite event stores;
- command-to-event helpers plus reference-node submission/read clients;
- minimal reference node API with memory/SQLite storage reporting, ranged event reads, and command acceptance;
- runnable reference node service entrypoint with graceful shutdown.

Near-term focus remains on tightening client ergonomics, auth/error boundaries, and core test/docs coverage before app-specific product work.
