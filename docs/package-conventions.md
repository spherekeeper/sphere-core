# Package Conventions

Each package should use:

- `src/index.ts` as the public export surface;
- `test/*.test.ts` for unit tests;
- `package.json` with `build`, `typecheck`, and `test` scripts;
- no app-specific dependencies in core packages;
- JSON-compatible public types unless explicitly documented otherwise.

Core packages must not import from apps. Apps may import from packages.

## Package admission criteria

A package belongs in `packages/` only if it is:

- app-agnostic;
- reusable across more than one app/node/adapter;
- close to protocol semantics;
- testable without live external services.

If code is Discord-specific, deployment-specific, or user-interface-specific, it should not enter core packages by default.

## Public API convention

Every package should expose its public API through `src/index.ts`. Internal modules may exist, but consumers should not import them directly.

## Testing convention

Every behavior-bearing package needs tests before implementation stabilizes. Protocol-level packages should also connect tests to JSON fixtures or test vectors where possible.
