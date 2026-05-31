#!/usr/bin/env node
import { runDemoFlow } from './index.js';

interface CliOptions {
  baseUrl: string;
  chainId: string;
  actorId: string;
  entityId: string;
  entityName: string;
  bearerToken?: string;
}

function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    if (!raw.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${raw}`);
    }
    const key = raw.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    values.set(key, value);
    index += 1;
  }

  const bearerToken = values.get('bearer-token') ?? env.SPHERE_NODE_BEARER_TOKEN;
  const options: CliOptions = {
    baseUrl: values.get('base-url') ?? env.SPHERE_NODE_URL ?? 'http://127.0.0.1:3080',
    chainId: required(values, env, 'chain-id', 'SPHERE_DEMO_CHAIN_ID'),
    actorId: required(values, env, 'actor-id', 'SPHERE_DEMO_ACTOR_ID'),
    entityId: required(values, env, 'entity-id', 'SPHERE_DEMO_ENTITY_ID'),
    entityName: values.get('entity-name') ?? env.SPHERE_DEMO_ENTITY_NAME ?? 'Ada Raver',
  };
  if (bearerToken !== undefined && bearerToken.length > 0) {
    options.bearerToken = bearerToken;
  }
  return options;
}

function required(values: Map<string, string>, env: NodeJS.ProcessEnv, argName: string, envName: string): string {
  const value = values.get(argName) ?? env[envName];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing --${argName} or ${envName}`);
  }
  return value;
}

function printUsage(): void {
  console.error(`Usage: sphere-demo --chain-id <id> --actor-id <id> --entity-id <id> [options]

Options:
  --base-url <url>       Sphere node URL. Defaults to SPHERE_NODE_URL or http://127.0.0.1:3080.
  --entity-name <name>   Entity name to create. Defaults to SPHERE_DEMO_ENTITY_NAME or Ada Raver.
  --bearer-token <token> Bearer token for auth-gated chain endpoints. Defaults to SPHERE_NODE_BEARER_TOKEN.
`);
}

try {
  const options = parseArgs(process.argv.slice(2), process.env);
  const result = await runDemoFlow(options);
  console.log(JSON.stringify({
    chainId: result.chainId,
    submittedEvent: {
      id: result.submittedEvent.id,
      sequence: result.submittedEvent.sequence,
      action: result.submittedEvent.action,
      resourceId: result.submittedEvent.resourceId,
    },
    entities: result.entities,
  }, null, 2));
} catch (error) {
  printUsage();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
