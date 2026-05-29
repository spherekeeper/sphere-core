# Architecture Notes

Sphere Core begins as an extraction and stabilization workspace, not a blank-slate rewrite.

## Layers

```text
Protocol contracts  -> JSON Schemas, examples, test vectors
Reference packages  -> TypeScript types, validators, IDs, events, graph, identity
Reference runtime   -> local node API, event store, graph projection
Adapters/apps       -> Discord, web, demos, and other integrations
```

## Canonical model

The first canonical primitives are expected to be:

- `Entity`
- `IdentityLink`
- `Edge`
- `Event`
- `Command`
- `Actor`

## Event-first model

Accepted mutations should produce events. Queryable graph state should be replayable from events.

## Runtime security boundary

The reference node is currently a local/trusted-development runtime. It intentionally does not implement app-level authentication or authorization yet; see [Runtime Security Boundary](runtime-security-boundary.md) for the current decision and the checklist required before exposing the node beyond trusted networks.

## Adapter model

Adapters consume events and project Sphere state into external platforms. They must support idempotent handling, checkpoint/resume, reconciliation, and explicit error states.
