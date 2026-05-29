# Runtime Security Boundary

The current Sphere reference node is a local/trusted-development runtime. It is not a production network service yet.

## Current decision

Keep the reference node unauthenticated by default, but make the boundary explicit and support an optional trusted-development bearer-token gate:

- Bind only in trusted environments.
- Do not expose the node directly to untrusted networks.
- Treat all write endpoints as trusted-local developer APIs.
- Add authentication, authorization, and rate limiting before remote or multi-user deployment.

This keeps early protocol and projection work simple while avoiding a false sense of production readiness.

## Trusted endpoints today

The following endpoints mutate or reveal chain state and currently rely on the deployment boundary unless `SPHERE_NODE_BEARER_TOKEN` is configured:

- `POST /chains/:chainId/events`
- `POST /chains/:chainId/commands`
- `GET /chains/:chainId/events`
- `GET /chains/:chainId/graph/entities`
- `GET /chains/:chainId/graph/entities/:entityId`
- `GET /chains/:chainId/graph/edges/from/:entityId`
- `GET /chains/:chainId/graph/edges/to/:entityId`
- `GET /chains/:chainId/graph/identity/:platform/:platformId`
- `GET /chains/:chainId/graph/diagnostics`

## Before exposing beyond localhost/trusted networks

Add at least:

1. **Authentication**: identify the caller, starting with a simple development bearer token or mTLS/proxy-auth boundary.
2. **Authorization**: decide which actors can append to which chains and which callers can read chain/projection data.
3. **Rate limiting**: protect command/event append endpoints and expensive projection queries.
4. **Request size limits**: cap event batches and command payloads intentionally.
5. **Audit logging**: record caller identity, chain id, endpoint, response status, and append result.
6. **Transport security**: use TLS or run behind a trusted local reverse proxy that terminates TLS.

## Implemented trusted-development gate

Sphere supports an optional shared bearer token for remotely reachable development nodes:

- Configure via `SPHERE_NODE_BEARER_TOKEN`.
- If unset, preserve current local/trusted-development behavior.
- If set, require the configured bearer `Authorization` header for all `/chains/*` endpoints.
- Treat this only as a trusted-development gate; do not treat a shared bearer token alone as sufficient production authorization.
- Keep `/health` and `/node/info` unauthenticated unless deployment needs otherwise.

This should be treated as a development gate, not final production authorization.
