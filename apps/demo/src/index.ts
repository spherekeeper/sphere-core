import {
  createCommandSubmissionClient,
  createEntityCreateCommand,
  createNodeReadClient,
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
  const readClient = createNodeReadClient({
    baseUrl: options.baseUrl,
    fetch: fetchImpl,
    ...(options.bearerToken === undefined ? {} : { bearerToken: options.bearerToken }),
  });

  const submitted = await client.submitCommand({ chainId: options.chainId, command });
  const graph = await readClient.listEntities({ chainId: options.chainId });

  return {
    chainId: options.chainId,
    submittedEvent: submitted.event,
    entities: graph.entities,
  };
}
