import {
  CommandSubmissionError,
  createCommandSubmissionClient,
  createEntityCreateCommand,
  type IdFactory,
} from '@sphere/commands';
import { SPHERE_SCHEMA_VERSION, type Entity, type Event, type JsonObject } from '@sphere/types';

export interface DemoFlowOptions {
  baseUrl: string;
  chainId: string;
  actorId: string;
  entityId: string;
  entityName: string;
  entityKind?: Entity['kind'];
  metadata?: JsonObject;
  bearerToken?: string;
  now?: Date;
  createId?: IdFactory;
  fetch?: typeof fetch;
}

export interface DemoFlowResult {
  chainId: string;
  submittedEvent: Event;
  entities: Entity[];
}

interface GraphEntitiesResponse {
  chainId: string;
  entities: Entity[];
}

export async function runDemoFlow(options: DemoFlowOptions): Promise<DemoFlowResult> {
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();
  const entity: Entity = {
    id: options.entityId,
    kind: options.entityKind ?? 'person',
    name: options.entityName,
    metadata: options.metadata ?? {},
    createdAt: timestamp,
    updatedAt: timestamp,
    schemaVersion: SPHERE_SCHEMA_VERSION,
  };
  const command = createEntityCreateCommand({
    actorId: options.actorId,
    entity,
    now,
    ...(options.createId === undefined ? {} : { createId: options.createId }),
  });
  const fetchImpl = options.fetch ?? fetch;
  const client = createCommandSubmissionClient({
    baseUrl: options.baseUrl,
    fetch: fetchImpl,
    ...(options.bearerToken === undefined ? {} : { bearerToken: options.bearerToken }),
  });

  const submitted = await client.submitCommand({ chainId: options.chainId, command });
  const graph = await fetchGraphEntities({
    baseUrl: options.baseUrl,
    chainId: options.chainId,
    fetch: fetchImpl,
    ...(options.bearerToken === undefined ? {} : { bearerToken: options.bearerToken }),
  });

  return {
    chainId: options.chainId,
    submittedEvent: submitted.event,
    entities: graph.entities,
  };
}

async function fetchGraphEntities(options: {
  baseUrl: string;
  chainId: string;
  bearerToken?: string;
  fetch: typeof fetch;
}): Promise<GraphEntitiesResponse> {
  const response = await options.fetch(
    `${options.baseUrl.replace(/\/+$/, '')}/chains/${encodeURIComponent(options.chainId)}/graph/entities`,
    {
      method: 'GET',
      headers: options.bearerToken === undefined ? {} : { authorization: `Bearer ${options.bearerToken}` },
    },
  );
  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new CommandSubmissionError(response.status, body);
  }
  return body as GraphEntitiesResponse;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
