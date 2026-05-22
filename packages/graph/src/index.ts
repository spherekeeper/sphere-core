import { verifyEventChain } from '@sphere/events';
import type { Edge, Entity, Event, JsonObject } from '@sphere/types';

export interface GraphProjection {
  entities: Map<string, Entity>;
  edges: Map<string, Edge>;
  appliedEventIds: string[];
}

export function createGraphProjection(): GraphProjection {
  return {
    entities: new Map(),
    edges: new Map(),
    appliedEventIds: [],
  };
}

export function replayEvents(events: readonly Event[], graph: GraphProjection = createGraphProjection()): GraphProjection {
  const verification = verifyEventChain(events);
  if (!verification.ok) {
    throw new Error(`Cannot replay invalid event chain: ${verification.code} at index ${verification.index}`);
  }

  for (const event of events) {
    projectEvent(graph, event);
  }

  return graph;
}

export function projectEvent(graph: GraphProjection, event: Event): GraphProjection {
  switch (event.action) {
    case 'entity.create': {
      const entity = entityFromCreateEvent(event);
      graph.entities.set(entity.id, entity);
      break;
    }
    case 'edge.create': {
      const edge = edgeFromCreateEvent(event);
      graph.edges.set(edge.id, edge);
      break;
    }
    default:
      break;
  }

  graph.appliedEventIds.push(event.id);
  return graph;
}

export function getEntity(graph: GraphProjection, id: string): Entity | undefined {
  return graph.entities.get(id);
}

export function getEdge(graph: GraphProjection, id: string): Edge | undefined {
  return graph.edges.get(id);
}

export function getEdgesFrom(graph: GraphProjection, sourceId: string): Edge[] {
  return [...graph.edges.values()].filter((edge) => edge.sourceId === sourceId);
}

export function getEdgesTo(graph: GraphProjection, targetId: string): Edge[] {
  return [...graph.edges.values()].filter((edge) => edge.targetId === targetId);
}

function entityFromCreateEvent(event: Event): Entity {
  const payloadEntity = asObject(event.payload.entity);

  return {
    id: stringFrom(payloadEntity.id, event.resourceId),
    kind: stringFrom(payloadEntity.kind, 'resource') as Entity['kind'],
    name: stringFrom(payloadEntity.name, event.resourceId),
    metadata: asObject(payloadEntity.metadata),
    createdAt: stringFrom(payloadEntity.createdAt, event.timestamp),
    updatedAt: stringFrom(payloadEntity.updatedAt, event.timestamp),
    schemaVersion: event.schemaVersion,
  };
}

function edgeFromCreateEvent(event: Event): Edge {
  const payloadEdge = asObject(event.payload.edge);

  return {
    id: stringFrom(payloadEdge.id, event.resourceType === 'edge' ? event.resourceId : event.id),
    sourceId: stringFrom(payloadEdge.sourceId, event.subjectId),
    targetId: stringFrom(payloadEdge.targetId, event.resourceId),
    type: stringFrom(payloadEdge.type, 'custom:unknown') as Edge['type'],
    metadata: asObject(payloadEdge.metadata),
    createdAt: stringFrom(payloadEdge.createdAt, event.timestamp),
    createdBy: stringFrom(payloadEdge.createdBy, event.actorId),
    schemaVersion: event.schemaVersion,
    deletedAt: nullableStringFrom(payloadEdge.deletedAt),
    deletedBy: nullableStringFrom(payloadEdge.deletedBy),
  };
}

function asObject(value: unknown): JsonObject {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function stringFrom(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') {
      return value;
    }
  }
  throw new TypeError('Expected at least one string value');
}

function nullableStringFrom(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
