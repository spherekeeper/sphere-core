# Sphere Core

[![CI](https://github.com/spherekeeper/sphere-core/actions/workflows/ci.yml/badge.svg)](https://github.com/spherekeeper/sphere-core/actions/workflows/ci.yml)

Private implementation workspace for Sphere core protocol schemas, TypeScript reference packages, and the first reference node experiments.

This repo is intentionally early and private. It exists to extract and stabilize the proven graph, identity, event, and adapter lessons from the existing Sphere Discord bot and graph service prototypes.

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

The current implementation plan is based on these existing prototypes:

```text
/data/tenants/sphere/discord-infrastructure/sphere-system
/data/tenants/sphere/web3-infrastructure/alpha_v0.1_firstprototype/sphere-graph
/data/tenants/sphere/web3-infrastructure/alpha_v0.1_firstprototype/sphere-web
```

Do not copy these wholesale. Extract concepts, tests, and migration fixtures deliberately.

## Development

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm test
pnpm typecheck
```

## Documentation

- [Architecture](docs/architecture.md)
- [Node Runtime](docs/node-runtime.md)
- [Testing](docs/testing.md)
- [Command Policy](docs/command-policy.md)
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
- command-to-event helpers and node submission client;
- minimal reference node API with memory/SQLite storage reporting and command acceptance;
- runnable reference node service entrypoint with graceful shutdown.

The next major runtime step is adding a small CLI/demo flow that creates commands and submits them to a running node.
