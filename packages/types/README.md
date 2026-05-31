# @sphere/types

Core Sphere protocol types, constants, and action payload definitions.

This package currently holds the shared draft protocol vocabulary used by the rest of the workspace, including:

- protocol and schema version constants;
- entity kinds, edge types, and platform enums;
- event envelope types;
- graph resource record types;
- command and action payload types;
- projection diagnostic types.

The package is intentionally type-centric. Runtime validation lives in [`@sphere/schemas`](../schemas/README.md), and deterministic serialization plus hash helpers live in [`@sphere/events`](../events/README.md).
