# Package Conventions

Each package should use:

- `src/index.ts` as the public export surface;
- `test/*.test.ts` for unit tests;
- `package.json` with `typecheck` and `test` scripts at minimum;
- a `build` script once the package needs distributable artifacts beyond source/workspace consumption;
- no app-specific dependencies in core packages;
- JSON-compatible public types unless explicitly documented otherwise.

## Current repo reality

Today the `sphere-core` packages are still workspace/source packages rather than published npm artifacts:

- `package.json` metadata currently points at `src/index.ts` for local workspace consumption;
- package-level `build` scripts are not required yet if the package is only consumed from source inside the monorepo or by direct repository checkout;
- once a package is prepared for npm publishing or other artifact-based distribution, add an explicit build/export/files story and update the README accordingly.

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
