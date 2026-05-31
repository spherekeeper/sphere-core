# Security Policy

## Current status

Sphere Core is an early-stage reference codebase.

It includes protocol types, validators, event hashing, replayable graph projection logic, an event store layer, and a minimal reference node/runtime for trusted development use.

It is **not** a production-hardened hosted service.

Before running the reference node outside localhost or a tightly controlled trusted network, read:

- [Runtime Security Boundary](docs/runtime-security-boundary.md)
- [Authorization Roadmap](docs/authorization-roadmap.md)
- [Node Runtime](docs/node-runtime.md)

## Supported scope

Security reports are most useful when they affect code or documented behavior currently present in this repository, such as:

- event validation or canonicalization bugs;
- event hash or chain-verification flaws;
- projection integrity issues;
- reference node request validation or auth-gate bypasses;
- accidental exposure of secrets or unsafe example material in the repository.

## Reporting a vulnerability

Please do **not** post full exploit details in a public GitHub issue.

Use the most private reporting path available in this order:

1. if this repository has GitHub private vulnerability reporting / security advisories enabled, use the repository's **Report a vulnerability** flow;
2. otherwise, use the repository owner's private GitHub contact path if one is available;
3. if neither private path is available yet, open a minimal public issue requesting a private reporting channel **without** including exploit details, then share the full report only after a private path has been established.

Maintainers: before or immediately after public launch, enable a dedicated private reporting route in repository settings so reporters do not have to fall back to step 3.

When you do send the report, include:

- a concise description of the problem;
- affected package, app, or file paths;
- reproduction steps or a proof of concept;
- impact assessment;
- suggested mitigation, if you have one.

## What to expect

Good-faith reports will be reviewed and triaged. Because this repository is still evolving quickly, fixes may land as direct commits to `main` before any broader release process exists.

## Operational warning

The reference node and demo CLI are intended for local development, testing, and protocol exploration.

Do not treat the current bearer-token gate or localhost-oriented defaults as sufficient protection for public internet exposure.
