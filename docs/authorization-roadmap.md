# Authorization Roadmap

Sphere Core currently has a narrow trusted-development authentication gate, not production authorization.

This note describes the current boundary and the direction for future caller auth, chain permissions, app-specific command authorization, and auditability. It is intentionally a roadmap: the reference node does not yet enforce the policies described under future phases.

## Current state

The reference node can be started with `SPHERE_NODE_BEARER_TOKEN`.

When configured:

- `/health` remains public;
- `/node/info` remains public;
- every `/chains/*` endpoint requires a matching HTTP bearer-token header;
- missing or wrong token returns `{ "error": "unauthorized" }` with status `401`.

This gate is useful for local demos and private development deployments. It answers only one question: "does this request know the shared runtime token?"

It does not answer:

- who the caller is;
- whether the caller controls `actorId`;
- whether the caller can read or write a chain;
- whether the caller is allowed to perform a command action;
- whether app-specific policy approved the intent.

## Boundary terms

### Caller

The authenticated network principal making an HTTP request: a user session, service token, agent credential, or app backend.

The current reference node does not model callers beyond the optional shared bearer token.

### Actor

The Sphere identity recorded in command and event envelopes as `actorId`.

`actorId` is protocol data. Today, clients can submit commands or direct events containing arbitrary actor ids if they can reach the chain endpoint. Future authorization must bind caller identity to allowed actor ids.

### Subject/resource

`subjectId`, `resourceType`, and `resourceId` describe what the event or command is about. They are not authorization checks by themselves.

### Command policy

The current `@sphere/commands` policy is structural and protocol-level. It checks rules such as resource type, resource id, supported actions, and payload presence. It is not caller authorization or app business authorization.

### App policy

Application-owned authorization and validation, such as who may invite someone to an event, approve an organizer, view attendee details, or submit a safety review.

App policy should sit above or beside core command submission until a pattern proves protocol-generic.

## Near-term requirements

Before exposing the node beyond trusted private contexts, the runtime needs explicit authorization interfaces for:

1. **Caller authentication**
   - Parse a caller credential into a stable caller principal.
   - Support local development auth without confusing it for production auth.
   - Avoid logging or storing raw credentials.

2. **Actor binding**
   - Decide which Sphere `actorId` values a caller may use.
   - Reject commands/events where caller and claimed actor do not match policy.
   - Preserve actor ids in canonical events after authorization succeeds.

3. **Chain permissions**
   - Decide which callers can read a chain.
   - Decide which callers can append direct events.
   - Decide which callers can submit commands.
   - Keep direct event append more restricted than command submission.

4. **Command authorization**
   - Evaluate command action, resource, actor, payload, caller, and current projection state.
   - Return stable authorization error shapes distinct from schema/policy errors.
   - Keep core policy generic; keep app-specific rules app-owned.

5. **Audit trail**
   - Record enough metadata to explain why a write was accepted or rejected.
   - Avoid putting secrets or raw credentials into events.
   - Preserve a link between network caller and protocol actor where appropriate.

## Suggested runtime shape

A future node could accept an authorization adapter when building the app:

```ts
interface RuntimeAuthorizer {
  authenticate(request: RequestContext): Promise<CallerPrincipal | null>;
  canReadChain(input: ChainReadAuthorizationInput): Promise<AuthorizationDecision>;
  canAppendEvents(input: EventAppendAuthorizationInput): Promise<AuthorizationDecision>;
  canSubmitCommand(input: CommandAuthorizationInput): Promise<AuthorizationDecision>;
}
```

Decision shape:

```ts
type AuthorizationDecision =
  | { ok: true; audit?: JsonObject }
  | { ok: false; code: string; message: string; audit?: JsonObject };
```

The key design point is that authorization is evaluated before mutation and before appending canonical history. Rejections should not create events unless the system deliberately introduces a separate audit/event stream for rejected intents.

## Error shape direction

Current auth-gate failure:

```json
{ "error": "unauthorized" }
```

Future authorization failures should distinguish authentication from authorization:

- `unauthorized`: no valid caller credential.
- `forbidden`: authenticated caller lacks permission for the chain/action/resource.
- `actor_not_allowed`: caller cannot act as the submitted `actorId`.
- `command_authorization_failed`: app/core authorization rejected a schema-valid, policy-valid command.

A future response could look like:

```json
{
  "error": "command_authorization_failed",
  "code": "event_invite_requires_organizer",
  "message": "Only event organizers can invite attendees"
}
```

These are proposed names, not current API guarantees.

## Direct events vs commands

Direct event append is lower-level and should be the most restricted write path.

Recommended future stance:

- app clients submit commands;
- app backends or trusted maintenance tools may append direct events;
- direct append must still verify caller permission, actor binding, chain id, hash linkage, and event schema;
- migrations/importers should run with explicit scoped credentials.

This preserves the command layer as the normal authorization boundary for app behavior while keeping event append available for protocol and maintenance use.

## Festival/rave planner implications

The first app candidate will need app-owned authorization before it can safely accept real users.

Likely app policy examples:

- only organizers can create or edit event pages;
- invite permissions depend on trust edges or organizer role;
- RSVP visibility may depend on event privacy settings;
- safety-review submission may be limited to attendees or trusted moderators;
- organizer overview endpoints must avoid leaking private attendee metadata;
- admin/moderation actions need stronger audit and revocation handling.

These rules should not be hard-coded into Sphere Core until a subset is clearly reusable across apps. They can begin as app-specific `custom:*` command authorization.

## Phased plan

### Phase 1: explicit interfaces and docs

- Keep `SPHERE_NODE_BEARER_TOKEN` as a development-only gate.
- Add explicit runtime authorization interfaces without changing default behavior.
- Add tests proving default development behavior remains unchanged.
- Document which endpoints would call which authorization hooks.

### Phase 2: actor and chain checks

- Require authenticated callers in non-development mode.
- Add actor-binding checks for command submission.
- Add chain read/write checks.
- Return stable `401`/`403` shapes.

### Phase 3: app authorization hooks

- Let apps register command authorization handlers.
- Pass current graph projection/read model into app policy where needed.
- Keep app rejections atomic: no command-derived events appended.
- Add app-level tests for festival/rave planner flows.

### Phase 4: auditability

- Define sanitized audit metadata.
- Decide whether rejections live in logs, a separate audit stream, or canonical command rejection events.
- Add retention/privacy guidance.

## Non-goals for now

- Production OAuth/OIDC integration.
- Multi-tenant hosting model.
- Key management and rotation UX.
- Public network federation policy.
- App-specific festival/rave planner authorization in core packages.

## Related docs

- [Runtime Security Boundary](./runtime-security-boundary.md)
- [Reference Node API](./api.md)
- [Command Policy](./command-policy.md)
- [Events and Actions](./events-and-actions.md)
- [Node Runtime](./node-runtime.md)
