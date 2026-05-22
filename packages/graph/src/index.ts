import { verifyEventChain } from '@sphere/events';
import { validateEventActionPayload } from '@sphere/schemas';
import type { Edge, Entity, Event, IdentityLink, JsonObject } from '@sphere/types';

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
  | 'invalid_event_payload'
  | 'entity_update_missing_entity'
  | 'entity_update_tombstoned_entity'
  | 'edge_delete_missing_edge'
  | 'identity_unlink_missing_identity';

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
  identityLinks: Map<string, IdentityLink>;
  identityLinksByEntity: Map<string, Set<string>>;
  identityLinksByPlatform: Map<string, string>;
  diagnostics: GraphProjectionDiagnostic[];
  appliedEventIds: string[];
}

export function createGraphProjection(): GraphProjection {
  return {
    entities: new Map(),
    entityTombstones: new Map(),
    edges: new Map(),
    identityLinks: new Map(),
    identityLinksByEntity: new Map(),
    identityLinksByPlatform: new Map(),
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
  const payloadValidation = validateEventActionPayload(event);
  if (!payloadValidation.ok) {
    const failure = payloadValidation as Extract<typeof payloadValidation, { ok: false }>;
    addDiagnostic(graph, {
      code: 'invalid_event_payload',
      severity: 'error',
      event,
      message: `Invalid payload for event action ${event.action}: ${failure.errors.join('; ')}`,
      resourceId: event.resourceId,
    });
    graph.appliedEventIds.push(event.id);
    return graph;
  }

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
    case 'identity.link': {
      linkIdentity(graph, event);
      break;
    }
    case 'identity.unlink': {
      unlinkIdentity(graph, event);
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

export function getIdentityLink(graph: GraphProjection, id: string): IdentityLink | undefined {
  return graph.identityLinks.get(id);
}

export function getIdentityLinksForEntity(graph: GraphProjection, entityId: string): IdentityLink[] {
  const ids = graph.identityLinksByEntity.get(entityId);
  if (ids === undefined) {
    return [];
  }
  return [...ids].map((id) => graph.identityLinks.get(id)).filter((link): link is IdentityLink => link !== undefined);
}

export function getIdentityLinkByPlatform(
  graph: GraphProjection,
  platform: string,
  platformId: string,
): IdentityLink | undefined {
  const id = graph.identityLinksByPlatform.get(identityPlatformKey(platform, platformId));
  return id === undefined ? undefined : graph.identityLinks.get(id);
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

function linkIdentity(graph: GraphProjection, event: Event): void {
  const link = identityLinkFromEvent(event);
  const previous = graph.identityLinks.get(link.id);
  if (previous !== undefined) {
    removeIdentityIndexes(graph, previous);
  }

  graph.identityLinks.set(link.id, link);
  let entityIndex = graph.identityLinksByEntity.get(link.entityId);
  if (entityIndex === undefined) {
    entityIndex = new Set<string>();
    graph.identityLinksByEntity.set(link.entityId, entityIndex);
  }
  entityIndex.add(link.id);
  graph.identityLinksByPlatform.set(identityPlatformKey(link.platform, link.platformId), link.id);
}

function unlinkIdentity(graph: GraphProjection, event: Event): void {
  const linkId = stringFrom(event.resourceId);
  const link = graph.identityLinks.get(linkId);
  if (link === undefined) {
    addDiagnostic(graph, {
      code: 'identity_unlink_missing_identity',
      severity: 'warning',
      event,
      message: `Cannot unlink missing identity ${linkId}`,
      resourceId: linkId,
    });
    return;
  }

  graph.identityLinks.delete(linkId);
  removeIdentityIndexes(graph, link);
}

function removeIdentityIndexes(graph: GraphProjection, link: IdentityLink): void {
  const entityIndex = graph.identityLinksByEntity.get(link.entityId);
  if (entityIndex !== undefined) {
    entityIndex.delete(link.id);
    if (entityIndex.size === 0) {
      graph.identityLinksByEntity.delete(link.entityId);
    }
  }
  graph.identityLinksByPlatform.delete(identityPlatformKey(link.platform, link.platformId));
}

function identityLinkFromEvent(event: Event): IdentityLink {
  const payloadLink = asObject(event.payload.identityLink ?? event.payload.identity_link);
  return {
    id: stringFrom(payloadLink.id, event.resourceId),
    entityId: stringFrom(payloadLink.entityId, event.subjectId),
    platform: stringFrom(payloadLink.platform),
    platformId: stringFrom(payloadLink.platformId),
    handle: nullableStringFrom(payloadLink.handle),
    verified: typeof payloadLink.verified === 'boolean' ? payloadLink.verified : false,
    metadata: asObject(payloadLink.metadata),
    createdAt: stringFrom(payloadLink.createdAt, event.timestamp),
    updatedAt: stringFrom(payloadLink.updatedAt, event.timestamp),
    schemaVersion: event.schemaVersion,
  };
}

function identityPlatformKey(platform: string, platformId: string): string {
  return `${platform}:${platformId}`;
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
