import Fastify, { type FastifyInstance } from 'fastify';

import {
  createInMemoryEventStore,
  createSqliteEventStore,
  EventStoreAppendError,
  getEventStoreMetadata,
  type EventStore,
} from '@sphere/event-store';
import {
  createGraphProjection,
  getEdgesFrom,
  getEdgesTo,
  getEntity,
  getIdentityLinkByPlatform,
  getProjectionDiagnostics,
  replayEvents,
} from '@sphere/graph';
import { SPHERE_SCHEMA_VERSION, type Event } from '@sphere/types';

export interface NodeAppOptions {
  eventStore?: EventStore;
}

export function buildNodeApp(options: NodeAppOptions = {}): FastifyInstance {
  const eventStore = options.eventStore ?? createInMemoryEventStore();
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ ok: true }));

  app.get('/node/info', async () => ({
    name: 'sphere-reference-node',
    schemaVersion: SPHERE_SCHEMA_VERSION,
    storage: getEventStoreMetadata(eventStore).storage,
  }));

  app.post<{ Params: ChainParams; Body: AppendEventsBody }>('/chains/:chainId/events', async (request, reply) => {
    const events = normalizeEventsBody(request.body);
    if (events === undefined) {
      return reply.code(400).send({ error: 'invalid_events_body' });
    }

    if (events.some((event) => event.chainId !== request.params.chainId)) {
      return reply.code(400).send({ error: 'chain_id_mismatch', chainId: request.params.chainId });
    }

    try {
      eventStore.append(events);
    } catch (error) {
      if (error instanceof EventStoreAppendError) {
        return reply.code(400).send({
          error: 'event_store_append_failed',
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    const latest = eventStore.getLatestEvent(request.params.chainId);
    return reply.code(201).send({
      appended: events.length,
      chainId: request.params.chainId,
      latestSequence: latest?.sequence ?? null,
    });
  });

  app.get<{ Params: ChainParams }>('/chains/:chainId/events', async (request) => ({
    chainId: request.params.chainId,
    events: eventStore.getEvents(request.params.chainId),
  }));

  app.get<{ Params: EntityParams }>('/chains/:chainId/graph/entities/:entityId', async (request, reply) => {
    const graph = projectChain(eventStore, request.params.chainId);
    const entity = getEntity(graph, request.params.entityId);
    if (entity === undefined) {
      return reply.code(404).send({ error: 'entity_not_found', id: request.params.entityId });
    }
    return entity;
  });

  app.get<{ Params: EntityParams }>('/chains/:chainId/graph/edges/from/:entityId', async (request) => {
    const graph = projectChain(eventStore, request.params.chainId);
    return { chainId: request.params.chainId, edges: getEdgesFrom(graph, request.params.entityId) };
  });

  app.get<{ Params: EntityParams }>('/chains/:chainId/graph/edges/to/:entityId', async (request) => {
    const graph = projectChain(eventStore, request.params.chainId);
    return { chainId: request.params.chainId, edges: getEdgesTo(graph, request.params.entityId) };
  });

  app.get<{ Params: IdentityParams }>('/chains/:chainId/graph/identity/:platform/:platformId', async (request, reply) => {
    const graph = projectChain(eventStore, request.params.chainId);
    const identityLink = getIdentityLinkByPlatform(graph, request.params.platform, request.params.platformId);
    if (identityLink === undefined) {
      return reply.code(404).send({
        error: 'identity_link_not_found',
        platform: request.params.platform,
        platformId: request.params.platformId,
      });
    }
    return identityLink;
  });

  app.get<{ Params: ChainParams }>('/chains/:chainId/graph/diagnostics', async (request) => {
    const graph = projectChain(eventStore, request.params.chainId);
    return { chainId: request.params.chainId, diagnostics: getProjectionDiagnostics(graph) };
  });

  return app;
}

export async function startNodeApp(): Promise<string> {
  const eventStore = process.env.SPHERE_NODE_DB === undefined
    ? createInMemoryEventStore()
    : createSqliteEventStore({ databasePath: process.env.SPHERE_NODE_DB });
  const app = buildNodeApp({ eventStore });
  const port = Number.parseInt(process.env.SPHERE_NODE_PORT ?? '3080', 10);
  return app.listen({ host: '0.0.0.0', port });
}

interface ChainParams {
  chainId: string;
}

interface EntityParams extends ChainParams {
  entityId: string;
}

interface IdentityParams extends ChainParams {
  platform: string;
  platformId: string;
}

interface AppendEventsBody {
  events?: unknown;
}

function normalizeEventsBody(body: AppendEventsBody | undefined): Event[] | undefined {
  if (body === undefined || !Array.isArray(body.events)) {
    return undefined;
  }
  return body.events as Event[];
}

function projectChain(eventStore: EventStore, chainId: string) {
  const events = eventStore.getEvents(chainId);
  return events.length === 0 ? createGraphProjection() : replayEvents(events);
}
