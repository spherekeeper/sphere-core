# Command Policy

Commands are intent-level records. Events are canonical history.

The command layer exists to make common client writes safer and more ergonomic without moving application-specific authorization into Sphere Core. The reference node can accept a command, derive the next event sequence and `previousHash` from the stored chain tip, convert the command into a hash-linked event, append it, and return the accepted event.

This document explains the current boundary between core command validation and app-specific command handling.

## Core responsibilities

Sphere Core currently owns:

- the `Command` protocol shape;
- schema parsing for command records;
- helper factories for common graph mutations;
- conversion from a command to a hash-linked event;
- built-in consistency checks for known core actions;
- a submission client for reference-node command and event endpoints;
- reference-node append behavior and error response shapes.

Sphere Core does not yet own:

- user authentication beyond the development bearer-token gate;
- actor authorization;
- app-specific business rules;
- moderation or safety review workflows;
- trust-weighted invitation policy;
- production rate limiting or audit logging.

Those belong in app-specific handlers, adapters, or future runtime authorization layers.

## Command versus event

A command says what an actor wants to do:

```json
{
  "id": "019e42ae-9c00-7000-8000-000000000100",
  "actorId": "019e42ae-9c00-7000-8000-000000000001",
  "action": "entity.update",
  "resourceType": "entity",
  "resourceId": "019e42ae-9c00-7000-8000-000000000002",
  "payload": { "entity": { "name": "Ada Commanded" } },
  "reason": null,
  "createdAt": "2026-05-28T00:00:00.000Z",
  "schemaVersion": "0.1.0"
}
```

An event records what was accepted into a chain:

- has `chainId`;
- has `sequence`;
- has `previousHash`;
- has a deterministic event `hash`;
- preserves projection payload fields such as `payload.entity`, `payload.edge`, or `payload.identityLink`;
- embeds the source command at `payload.command` for traceability when created from a command.

Clients submitting to `POST /chains/:chainId/commands` do not provide sequence numbers or previous hashes. The node derives those from the chain tip.

## Built-in known actions

The core command policy currently understands these action families:

- `entity.create`
- `entity.update`
- `entity.delete`
- `identity.link`
- `identity.unlink`
- `edge.create`
- `edge.delete`

Known-action checks are consistency checks, not full authorization. They ensure a command is internally coherent before it is converted into an event.

Current checks:

- `entity.*` commands must use `resourceType: "entity"`.
- `identity.*` commands must use `resourceType: "identity_link"`.
- `edge.*` commands must use `resourceType: "edge"`.
- Create/link commands must include the expected payload object.
- Create/link payload object ids must match `resourceId`.
- Update commands must include a non-empty `resourceId` and an expected patch object.
- Delete/unlink commands must include a non-empty `resourceId`.
- Non-custom actions outside the built-in set are rejected.

The stable policy violation codes are:

- `resource_type_mismatch`
- `resource_id_required`
- `resource_id_mismatch`
- `missing_payload_object`
- `payload_id_required`
- `unsupported_action`

`validateCommandPolicy(command)` returns `{ ok: true }` or `{ ok: false, errors }`. `createCommandEvent` calls the policy and throws `CommandPolicyError` when it fails.

## Policy-open custom actions

Actions beginning with `custom:` are intentionally policy-open in Sphere Core.

Reasoning:

- app-specific commands need contracts that are not protocol-generic;
- early apps should not fork core packages to add domain verbs;
- core can preserve a stable command/event envelope while apps own their semantics;
- unsupported non-custom actions should still be caught because they are likely typos or premature protocol claims.

Examples of future app-specific actions for the festival/rave planner candidate:

- `custom:festival.event.create`
- `custom:festival.rsvp`
- `custom:festival.invite.issue`
- `custom:festival.safety.review`
- `custom:collective.member.approve`

These names are examples, not committed protocol actions.

## App-specific handler boundary

An app-specific command handler should run before a custom command is accepted into canonical history.

Recommended responsibilities:

1. Parse the command with the shared command schema.
2. Require `action` to match the app namespace, such as `custom:festival.*`.
3. Validate `resourceType` and `payload` with app-owned schemas.
4. Authenticate the caller at the app/API boundary.
5. Authorize `actorId` against chain state, trust edges, roles, or app policy.
6. Enforce rate limits and request-size limits.
7. Convert accepted intent into one or more Sphere events or submit the command to the node.
8. Record enough audit context to explain why the write was accepted.

Do not put app business rules directly into `@sphere/commands` unless they are truly protocol-generic.

## Reference node command flow

`POST /chains/:chainId/commands` performs this flow:

1. Parse request body as `{ "command": Command }`.
2. Reject malformed bodies with `invalid_command_body`.
3. Run built-in command policy.
4. Reject policy failures with `command_policy_failed` and policy errors.
5. Read the latest event for the URL chain id.
6. Create an event with sequence `1` for an empty chain, otherwise latest sequence plus one.
7. Link `previousHash` to the latest event hash when the chain is non-empty.
8. Preserve command payload fields and add `payload.command`.
9. Append the event through the event store.
10. Return `{ accepted: true, chainId, event }` with HTTP `201`.

Append races or event-store verification failures return `event_store_append_failed` with the underlying store code and message.

## Direct event submission versus command submission

Prefer command submission when:

- a client is performing a normal user-facing write;
- the node should own sequence and previous-hash derivation;
- the write maps to a known command helper;
- the command should remain traceable inside the accepted event.

Prefer direct event submission when:

- importing a verified historical chain;
- running low-level event-store or graph fixtures;
- testing invalid/tampered chain rejection;
- a future authorized service already owns event construction and chain-tip coordination.

## Authorization boundary today

The reference node is trusted-development software. `SPHERE_NODE_BEARER_TOKEN` can require a shared token for `/chains/*` endpoints, but this is not production authorization.

Before using command endpoints in a remote or multi-user setting, add at least:

- caller authentication;
- actor-to-caller binding;
- per-chain and per-action authorization;
- rate limiting;
- request-size limits;
- audit logging;
- TLS or a trusted TLS-terminating proxy.

See [Runtime Security Boundary](./runtime-security-boundary.md).

## Festival/rave planner implications

For the first app candidate, keep the core/app split explicit:

- Core can model people, collectives, events, memberships, trust edges, and identity links as generic entities and edges.
- The festival app should own RSVP rules, invite issuance, organizer approval, safety review states, and visibility policy.
- App handlers can read projected graph state to decide whether a custom command is allowed.
- Accepted custom commands should still become hash-linked events so later projections can reconstruct decisions.
- If a domain action proves generally useful across apps, promote it deliberately into a core action with schema, policy, projection, tests, and docs.

## Testing expectations

Related event payload and projection semantics are documented in [Events and Actions](./events-and-actions.md). The HTTP endpoint contract is documented in [Reference Node API](./api.md).

When changing command policy or command submission:

- update `packages/commands/test/commands.test.ts` for helper and policy behavior;
- update `apps/node/test/node.test.ts` for endpoint behavior and stable errors;
- add app-level tests for any custom action contract outside core;
- keep `custom:*` policy-open unless the core/app boundary is intentionally changed;
- run `pnpm --filter @sphere/commands test`, `pnpm --filter @sphere/node test`, `pnpm test`, and `pnpm typecheck`.
