# Contributing to Sphere Core

Thanks for your interest in improving Sphere Core.

This repository is still in an early stabilization phase. Contributions are welcome, but the most useful changes are small, well-scoped improvements that keep protocol semantics, tests, and documentation aligned.

## Before you start

Please read these docs first when relevant:

- [README](README.md)
- [Architecture](docs/architecture.md)
- [Testing](docs/testing.md)
- [Command Policy](docs/command-policy.md)
- [Runtime Security Boundary](docs/runtime-security-boundary.md)
- [Authorization Roadmap](docs/authorization-roadmap.md)

If you want to propose a larger change, open an issue first so the protocol or package boundary can be discussed before implementation work starts.

## Development setup

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
```

## Required checks

Run these before sending a change:

```bash
pnpm test
pnpm typecheck
git diff --check
```

The CI workflow also scans added lines for obvious secret-like values. Do not commit credentials, private keys, copied production data, or private member data.

## Contribution guidelines

### Keep changes focused

Prefer small pull requests or commits that do one thing clearly:

- fix a bug;
- tighten a package boundary;
- improve docs to match the current code;
- add tests for an existing behavior;
- add a narrowly scoped protocol/runtime capability with tests.

### Keep docs and tests in sync

If you change behavior, update the relevant docs and tests in the same change.

Common doc surfaces:

- root [README](README.md)
- package or app `README.md`
- `docs/*.md` for runtime, policy, testing, and architecture notes
- `specs/` for protocol examples, schemas, and test vectors

### Respect current scope boundaries

A few boundaries matter in this repo today:

- graph state is a projection over events;
- platform integrations are adapters, not protocol primitives;
- app-specific authorization should not be pushed into core packages prematurely;
- the reference node and demo CLI are development/reference tools, not production services;
- workspace packages are not yet published to npm.

If a change crosses one of those boundaries, explain why in the issue or PR description.

### Preserve public-readiness hygiene

When editing public-facing files:

- avoid private/internal filesystem paths unless intentionally documented;
- avoid repo language that implies production-readiness where it does not exist;
- use synthetic fixtures instead of copied real-world data;
- prefer stable placeholders like `TOKEN_VALUE` instead of real-looking secrets.

## Security reporting

If you believe you found a security issue, please do **not** open a public issue with exploit details.

Follow [SECURITY.md](SECURITY.md) instead.

## Review expectations

A change is in good shape when it:

- matches current architecture and package boundaries;
- includes tests or a clear explanation for why tests are not needed;
- updates docs when user-visible or developer-visible behavior changed;
- passes `pnpm test`, `pnpm typecheck`, and `git diff --check`.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
