import { verifyEventChain } from '@sphere/events';
import type { Edge, Entity, Event, JsonObject } from '@sphere/types';

export interface EntityTombstone {
  id: string;
  deletedAt: string;
  deletedBy: string;
  eventId: string;
  reason: string | null;
}

export type GraphProjectionDiagnosticSeverity = 'info' | 'warning' | 'error';

export type GraphProjectionDiagnosticCode =
  | 'unsupported_action'
  | 'entity_update_missing_entity'
  | 'entity_update_tombstoned_entity'
  | 'edge_delete_missing_edge';

export interface GraphProjectionDiagnostic {
  code: GraphProjectionDiagnosticCode;
  severity: GraphProjectionDiagnosticSeverity;
  eventId: string;
  action: Event['action'];
  message: string;
  resourceId?: string | null;
}

export interface GraphProjection {
  entities: Map<string, Entity>;
  entityTombstones: Map<string, EntityTombstone>;
  edges: Map<string, Edge>;
  diagnostics: GraphProjectionDiagnostic[];
  appliedEventIds: string[];
}

export function createGraphProjection(): GraphProjection {
  return {
    entities: new Map(),
    entityTombstones: new Map(),
    edges: new Map(),
    diagnostics: [],
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
      graph.entityTombstones.delete(entity.id);
      break;
    }
    case 'entity.update': {
      updateEntity(graph, event);
      break;
    }
    case 'entity.delete': {
      deleteEntity(graph, event);
      break;
    }
    case 'edge.create': {
      const edge = edgeFromCreateEvent(event);
      graph.edges.set(edge.id, edge);
      break;
    }
    case 'edge.delete': {
      deleteEdge(graph, event);
      break;
    }
    default:
      addDiagnostic(graph, {
        code: 'unsupported_action',
        severity: 'info',
        event,
        message: `No projection handler for event action ${event.action}`,
      });
      break;
  }

  graph.appliedEventIds.push(event.id);
  return graph;
}

export function getEntity(graph: GraphProjection, id: string): Entity | undefined {
  if (graph.entityTombstones.has(id)) {
    return undefined;
  }
  return graph.entities.get(id);
}

export function getEntityTombstone(graph: GraphProjection, id: string): EntityTombstone | undefined {
  return graph.entityTombstones.get(id);
}

export function getEdge(graph: GraphProjection, id: string): Edge | undefined {
  return graph.edges.get(id);
}

export function getEdgesFrom(graph: GraphProjection, sourceId: string): Edge[] {
  return [...graph.edges.values()].filter((edge) => edge.sourceId === sourceId && edge.deletedAt == null);
}

export function getEdgesTo(graph: GraphProjection, targetId: string): Edge[] {
  return [...graph.edges.values()].filter((edge) => edge.targetId === targetId && edge.deletedAt == null);
}

export function getProjectionDiagnostics(graph: GraphProjection): readonly GraphProjectionDiagnostic[] {
  return graph.diagnostics;
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

function updateEntity(graph: GraphProjection, event: Event): void {
  const entityId = stringFrom(event.resourceId, event.subjectId);
  const current = graph.entities.get(entityId);
  if (current === undefined) {
    addDiagnostic(graph, {
      code: 'entity_update_missing_entity',
      severity: 'warning',
      event,
      message: `Cannot update missing entity ${entityId}`,
      resourceId: entityId,
    });
    return;
  }
  if (graph.entityTombstones.has(entityId)) {
    addDiagnostic(graph, {
      code: 'entity_update_tombstoned_entity',
      severity: 'warning',
      event,
      message: `Cannot update tombstoned entity ${entityId}`,
      resourceId: entityId,
    });
    return;
  }

  const patch = asObject(event.payload.entity);
  graph.entities.set(entityId, {
    ...current,
    kind: typeof patch.kind === 'string' ? (patch.kind as Entity['kind']) : current.kind,
    name: stringFrom(patch.name, current.name),
    metadata: {
      ...current.metadata,
      ...asObject(patch.metadata),
    },
    updatedAt: stringFrom(patch.updatedAt, event.timestamp),
  });
}

function deleteEntity(graph: GraphProjection, event: Event): void {
  const entityId = stringFrom(event.resourceId, event.subjectId);
  graph.entityTombstones.set(entityId, {
    id: entityId,
    deletedAt: event.timestamp,
    deletedBy: event.actorId,
    eventId: event.id,
    reason: event.reason,
  });
}

function deleteEdge(graph: GraphProjection, event: Event): void {
  const edgeId = stringFrom(event.resourceId);
  const current = graph.edges.get(edgeId);
  if (current === undefined) {
    addDiagnostic(graph, {
      code: 'edge_delete_missing_edge',
      severity: 'warning',
      event,
      message: `Cannot delete missing edge ${edgeId}`,
      resourceId: edgeId,
    });
    return;
  }

  graph.edges.set(edgeId, {
    ...current,
    deletedAt: event.timestamp,
    deletedBy: event.actorId,
  });
}

interface DiagnosticInput {
  code: GraphProjectionDiagnosticCode;
  severity: GraphProjectionDiagnosticSeverity;
  event: Event;
  message: string;
  resourceId?: string | null;
}

function addDiagnostic(graph: GraphProjection, input: DiagnosticInput): void {
  graph.diagnostics.push({
    code: input.code,
    severity: input.severity,
    eventId: input.event.id,
    action: input.event.action,
    message: input.message,
    ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
  });
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
