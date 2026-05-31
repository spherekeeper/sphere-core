# Sphere Demo CLI

Minimal demo client for a running Sphere reference node.

The demo flow intentionally stays small:

1. build an `entity.create` command;
2. submit it to `POST /chains/:chainId/commands`;
3. read back `GET /chains/:chainId/graph/entities`;
4. print the submitted event summary and current projected entities as JSON.

It is meant to smoke-test client/runtime wiring after starting a local node. It is not a production CLI.

## Run the node

From the repository root:

```bash
pnpm --filter @sphere/node start
```

In another shell, run the demo:

```bash
pnpm --filter @sphere/demo demo \
  --chain-id 019e42ae-9c00-7000-8000-000000000000 \
  --actor-id 019e42ae-9c00-7000-8000-000000000001 \
  --entity-id 019e42ae-9c00-7000-8000-000000000002 \
  --entity-name "Ada Raver"
```

The default node URL is `http://127.0.0.1:3080`. Override it with `--base-url` or `SPHERE_NODE_URL`.

## Auth-gated local node

If the node is started with `SPHERE_NODE_BEARER_TOKEN`, pass the same value through the environment or `--bearer-token`:

```bash
SPHERE_NODE_BEARER_TOKEN=TOKEN_VALUE pnpm --filter @sphere/demo demo \
  --chain-id 019e42ae-9c00-7000-8000-000000000000 \
  --actor-id 019e42ae-9c00-7000-8000-000000000001 \
  --entity-id 019e42ae-9c00-7000-8000-000000000002
```

## Environment variables

- `SPHERE_NODE_URL`: node base URL.
- `SPHERE_NODE_BEARER_TOKEN`: optional trusted-development bearer token.
- `SPHERE_DEMO_CHAIN_ID`: default chain id.
- `SPHERE_DEMO_ACTOR_ID`: default command actor id.
- `SPHERE_DEMO_ENTITY_ID`: default entity id.
- `SPHERE_DEMO_ENTITY_NAME`: default entity name.

## Programmatic use

`runDemoFlow` is exported from `@sphere/demo` for tests and examples. It accepts explicit ids, submits an entity-create command, and returns:

- `chainId`
- `submittedEvent`
- `entities`

See `apps/demo/test/demo.test.ts` for a deterministic runtime-backed example.
