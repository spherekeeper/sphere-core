# @sphere/schemas

Runtime validation helpers for Sphere draft protocol objects.

This is currently a workspace/source package in the `sphere-core` monorepo. It is not published to npm yet.

Exports JSON Schema objects and parse/validate helpers for:

- `Entity`
- `IdentityLink`
- `Edge`
- `Event`
- `Command`

It also exposes `validateEventActionPayload(event)`, which validates the event envelope and then applies action-specific payload checks for known projection actions:

- `entity.create`
- `entity.update`
- `entity.delete`
- `edge.create`
- `edge.delete`
- `identity.link`
- `identity.unlink`

Compact projection payloads are allowed where the projection contract derives defaults from the event envelope. For example, `edge.create` may derive source/target/timestamps from the event while still validating the effective edge shape.
