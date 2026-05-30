import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { linkEvent, withEventHash } from '@sphere/events';
import type { Event, EventWithoutHash, IdentityLink } from '@sphere/types';
import {
  createGraphProjection,
  replayEvents,
  projectEvent,
  getEntity,
  getEdge,
  getEdgesFrom,
  getEdgesTo,
  getEntityTombstone,
  getProjectionDiagnostics,
  listEntities,
  getIdentityLink,
  getIdentityLinksForEntity,
  getIdentityLinkByPlatform,
  snapshotGraphProjection,
} from '../src/index.js';

const repoRoot = join(__dirname, '../../..');
const chainFixture = JSON.parse(
  readFileSync(join(repoRoot, 'specs/test-vectors/hash-chain/valid-basic-chain.json'), 'utf8'),
) as Event[];

const brokenPreviousHashFixture = JSON.parse(
  readFileSync(join(repoRoot, 'specs/test-vectors/hash-chain/invalid-broken-previous-hash.json'), 'utf8'),
) as Event[];

const updateDeleteFixture = JSON.parse(
  readFileSync(join(repoRoot, 'specs/test-vectors/graph-projection/entity-edge-update-delete-chain.json'), 'utf8'),
) as Event[];

const identityFixture = JSON.parse(
  readFileSync(join(repoRoot, 'specs/test-vectors/graph-projection/identity-link-unlink-chain.json'), 'utf8'),
) as Event[];

function loadGraphProjectionFixture(name: string): { events: Event[]; snapshot: unknown } {
  const fixtureRoot = join(repoRoot, 'specs/test-vectors/graph-projection', name);
  return {
    events: JSON.parse(readFileSync(join(fixtureRoot, 'events.json'), 'utf8')) as Event[],
    snapshot: JSON.parse(readFileSync(join(fixtureRoot, 'snapshot.json'), 'utf8')),
  };
}

const baseEvent = chainFixture[0]!;
const entityId = '019e42ae-9c00-7000-8000-000000000004';
const actorId = '019e42ae-9c00-7000-8000-000000000002';

function eventWithoutHash(overrides: Partial<EventWithoutHash>): EventWithoutHash {
  return {
    id: stringFrom(overrides.id, `019e42ae-9c00-7000-8000-${String(overrides.sequence ?? 1).padStart(12, '0')}`),
    chainId: baseEvent.chainId,
    sequence: overrides.sequence ?? 1,
    actorId,
    subjectId: entityId,
    action: overrides.action ?? 'custom:test',
    resourceType: overrides.resourceType ?? 'entity',
    resourceId: overrides.resourceId ?? entityId,
    timestamp: overrides.timestamp ?? '2026-05-20T00:00:00.000Z',
    payload: overrides.payload ?? {},
    reason: overrides.reason ?? null,
    schemaVersion: '0.1.0',
    hashAlgorithm: 'sha256',
    previousHash: overrides.previousHash ?? null,
  };
}

function validChain(...events: EventWithoutHash[]): Event[] {
  const [first, ...rest] = events;
  if (first === undefined) {
    throw new Error('validChain requires at least one event');
  }

  const chain = [withEventHash(first as unknown as Record<string, unknown>) as unknown as Event];
  for (const event of rest) {
    chain.push(linkEvent(chain[chain.length - 1]!, event as unknown as Record<string, unknown>) as unknown as Event);
  }
  return chain;
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function identityLink(overrides: Partial<IdentityLink> = {}): IdentityLink {
  return {
    id: overrides.id ?? '019e42ae-9c00-7000-8000-000000000120',
    entityId: overrides.entityId ?? entityId,
    platform: overrides.platform ?? 'discord',
    platformId: overrides.platformId ?? '1234567890',
    handle: overrides.handle ?? 'spherekeeper',
    verified: overrides.verified ?? true,
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? '2026-05-20T05:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-20T05:00:00.000Z',
    schemaVersion: '0.1.0',
  };
}

describe('@sphere/graph', () => {
  it('creates an empty in-memory graph projection', () => {
    const graph = createGraphProjection();

    expect(graph.entities.size).toBe(0);
    expect(graph.edges.size).toBe(0);
    expect(graph.appliedEventIds).toEqual([]);
    expect(graph.skippedEventIds).toEqual([]);
  });

  it('projects entity.create events into entity state', () => {
    const graph = projectEvent(createGraphProjection(), chainFixture[0]!);

    expect(getEntity(graph, '019e42ae-9c00-7000-8000-000000000004')).toMatchObject({
      id: '019e42ae-9c00-7000-8000-000000000004',
      kind: 'group',
      name: 'Sphere <Core> & Friends',
      metadata: {},
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      schemaVersion: '0.1.0',
    });
    expect(graph.appliedEventIds).toEqual(['019e42ae-9c00-7000-8000-000000000001']);
  });

  it('lists active entities sorted by id and excludes tombstones', () => {
    const lowEntityId = '019e42ae-9c00-7000-8000-000000000003';
    const highEntityId = '019e42ae-9c00-7000-8000-000000000099';
    const chain = validChain(
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000301',
        sequence: 1,
        action: 'entity.create',
        resourceId: highEntityId,
        payload: { entity: { id: highEntityId, kind: 'group', name: 'High', metadata: {} } },
      }),
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000302',
        sequence: 2,
        action: 'entity.create',
        resourceId: lowEntityId,
        payload: { entity: { id: lowEntityId, kind: 'person', name: 'Low', metadata: {} } },
      }),
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000303',
        sequence: 3,
        action: 'entity.delete',
        resourceId: highEntityId,
      }),
    );

    expect(listEntities(replayEvents(chain)).map((entity) => entity.id)).toEqual([lowEntityId]);
  });

  it('replays a verified chain into entities and derived edges', () => {
    const graph = replayEvents(chainFixture);

    const entity = getEntity(graph, '019e42ae-9c00-7000-8000-000000000004');
    const edge = getEdge(graph, '019e42ae-9c00-7000-8000-000000000005');

    expect(entity?.name).toBe('Sphere <Core> & Friends');
    expect(edge).toMatchObject({
      id: '019e42ae-9c00-7000-8000-000000000005',
      sourceId: '019e42ae-9c00-7000-8000-000000000003',
      targetId: '019e42ae-9c00-7000-8000-000000000004',
      type: 'member_of',
      metadata: {},
      createdAt: '2026-05-20T00:00:00.000Z',
      createdBy: '019e42ae-9c00-7000-8000-000000000002',
      schemaVersion: '0.1.0',
    });
    expect(getEdgesFrom(graph, '019e42ae-9c00-7000-8000-000000000003')).toEqual([edge]);
    expect(getEdgesTo(graph, '019e42ae-9c00-7000-8000-000000000004')).toEqual([edge]);
    expect(graph.appliedEventIds).toEqual(chainFixture.map((event) => event.id));
  });

  it('replays non-genesis suffixes into an existing projection', () => {
    const graph = replayEvents([chainFixture[0]!]);

    replayEvents(chainFixture.slice(1), graph);

    expect(graph.appliedEventIds).toEqual(chainFixture.map((event) => event.id));
    expect(graph.lastAppliedEvent).toEqual(chainFixture[chainFixture.length - 1]);
    expect(getEdge(graph, '019e42ae-9c00-7000-8000-000000000005')).toBeDefined();
  });

  it('replays later incremental pages after the replay cursor advances past genesis', () => {
    const chain = validChain(
      eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000601', sequence: 1, action: 'entity.create', payload: { entity: { id: entityId, kind: 'group', name: 'Page One', metadata: {} } } }),
      eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000602', sequence: 2, action: 'entity.update', payload: { entity: { name: 'Page Two' } } }),
      eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000603', sequence: 3, action: 'entity.update', payload: { entity: { name: 'Page Three' } } }),
    );
    const graph = replayEvents([chain[0]!, chain[1]!]);

    replayEvents([chain[2]!], graph);

    expect(graph.appliedEventIds).toEqual(chain.map((event) => event.id));
    expect(graph.lastReplayedEvent).toEqual(chain[2]);
    expect(getEntity(graph, entityId)?.name).toBe('Page Three');
  });

  it('skips duplicate event ids during replay and records diagnostics', () => {
    const graph = replayEvents(chainFixture);

    replayEvents(chainFixture, graph);
    replayEvents(chainFixture, graph);

    expect(graph.appliedEventIds).toEqual(chainFixture.map((event) => event.id));
    expect(graph.skippedEventIds).toEqual(chainFixture.map((event) => event.id));
    expect(getProjectionDiagnostics(graph).map((diagnostic) => diagnostic.code)).toEqual(
      [...chainFixture, ...chainFixture].map(() => 'duplicate_event_skipped'),
    );
  });

  it('rejects unverified chains before replaying projection state', () => {
    expect(() => replayEvents(brokenPreviousHashFixture)).toThrow(/previous_hash_mismatch/);
  });

  it('applies entity.update events as shallow entity patches with metadata merge', () => {
    const [createEvent] = chainFixture;
    const chain = validChain(
      { ...createEvent!, hash: undefined } as unknown as EventWithoutHash,
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000006',
        sequence: 2,
        action: 'entity.update',
        timestamp: '2026-05-20T01:00:00.000Z',
        payload: {
          entity: {
            name: 'Sphere Core Builders',
            metadata: { purpose: 'protocol extraction' },
          },
        },
      }),
    );

    const graph = replayEvents(chain);

    expect(getEntity(graph, entityId)).toMatchObject({
      id: entityId,
      kind: 'group',
      name: 'Sphere Core Builders',
      metadata: { purpose: 'protocol extraction' },
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T01:00:00.000Z',
    });
  });

  it('records entity tombstones and hides deleted entities from active lookup', () => {
    const [createEvent] = chainFixture;
    const chain = validChain(
      { ...createEvent!, hash: undefined } as unknown as EventWithoutHash,
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000007',
        sequence: 2,
        action: 'entity.delete',
        timestamp: '2026-05-20T02:00:00.000Z',
        reason: 'test deletion',
      }),
    );

    const graph = replayEvents(chain);

    expect(getEntity(graph, entityId)).toBeUndefined();
    expect(listEntities(graph)).toEqual([]);
    expect(getEntityTombstone(graph, entityId)).toEqual({
      id: entityId,
      deletedAt: '2026-05-20T02:00:00.000Z',
      deletedBy: actorId,
      eventId: '019e42ae-9c00-7000-8000-000000000007',
      reason: 'test deletion',
    });
  });

  it('applies edge.delete events as edge tombstones and excludes deleted edges from directional lookup', () => {
    const chain = validChain(
      ...chainFixture.map((event) => ({ ...event, hash: undefined }) as unknown as EventWithoutHash),
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000008',
        sequence: 3,
        action: 'edge.delete',
        resourceType: 'edge',
        resourceId: '019e42ae-9c00-7000-8000-000000000005',
        timestamp: '2026-05-20T03:00:00.000Z',
        reason: 'membership revoked',
      }),
    );

    const graph = replayEvents(chain);
    const deletedEdge = getEdge(graph, '019e42ae-9c00-7000-8000-000000000005');

    expect(deletedEdge).toMatchObject({
      deletedAt: '2026-05-20T03:00:00.000Z',
      deletedBy: actorId,
    });
    expect(getEdgesFrom(graph, '019e42ae-9c00-7000-8000-000000000003')).toEqual([]);
    expect(getEdgesTo(graph, entityId)).toEqual([]);
  });

  it('replays the update/delete graph projection test vector', () => {
    const graph = replayEvents(updateDeleteFixture);

    expect(getEntity(graph, entityId)).toBeUndefined();
    expect(getEntityTombstone(graph, entityId)?.reason).toBe('group retired');
    expect(getEdge(graph, '019e42ae-9c00-7000-8000-000000000205')).toMatchObject({
      deletedAt: '2026-05-20T03:00:00.000Z',
      deletedBy: actorId,
    });
  });

  it('records diagnostics for unsupported custom events instead of silently skipping them', () => {
    const [createEvent] = chainFixture;
    const chain = validChain(
      { ...createEvent!, hash: undefined } as unknown as EventWithoutHash,
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000009',
        sequence: 2,
        action: 'custom:noop',
        resourceType: 'custom:noop',
        resourceId: null,
      }),
    );

    const graph = replayEvents(chain);

    expect(getProjectionDiagnostics(graph)).toEqual([
      {
        code: 'unsupported_action',
        severity: 'info',
        eventId: '019e42ae-9c00-7000-8000-000000000009',
        action: 'custom:noop',
        message: 'No projection handler for event action custom:noop',
      },
    ]);
  });

  it('records diagnostics for missing update/delete targets', () => {
    const missingEntityId = '019e42ae-9c00-7000-8000-000000999999';
    const missingEdgeId = '019e42ae-9c00-7000-8000-000000888888';
    const chain = validChain(
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000010',
        sequence: 1,
        action: 'entity.update',
        resourceType: 'entity',
        resourceId: missingEntityId,
        payload: { entity: { name: 'Missing' } },
      }),
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000011',
        sequence: 2,
        action: 'edge.delete',
        resourceType: 'edge',
        resourceId: missingEdgeId,
      }),
    );

    const graph = replayEvents(chain);

    expect(getProjectionDiagnostics(graph).map((diagnostic) => diagnostic.code)).toEqual([
      'entity_update_missing_entity',
      'edge_delete_missing_edge',
    ]);
    expect(getProjectionDiagnostics(graph)[0]).toMatchObject({
      severity: 'warning',
      eventId: '019e42ae-9c00-7000-8000-000000000010',
      resourceId: missingEntityId,
    });
  });

  it('records diagnostics for unlinking a missing identity', () => {
    const missingIdentityId = '019e42ae-9c00-7000-8000-000000777777';
    const graph = projectEvent(
      createGraphProjection(),
      withEventHash(
        eventWithoutHash({
          action: 'identity.unlink',
          resourceType: 'identity_link',
          resourceId: missingIdentityId,
        }) as unknown as Record<string, unknown>,
      ) as unknown as Event,
    );

    expect(getProjectionDiagnostics(graph)).toEqual([
      expect.objectContaining({
        code: 'identity_unlink_missing_identity',
        severity: 'warning',
        action: 'identity.unlink',
        resourceId: missingIdentityId,
      }),
    ]);
  });

  it('projects identity.link events and indexes identities by entity and platform id', () => {
    const link = identityLink();
    const chain = validChain(
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000012',
        sequence: 1,
        action: 'identity.link',
        resourceType: 'identity_link',
        resourceId: link.id,
        payload: { identityLink: link },
      }),
    );

    const graph = replayEvents(chain);

    expect(getIdentityLink(graph, link.id)).toEqual(link);
    expect(getIdentityLinksForEntity(graph, entityId)).toEqual([link]);
    expect(getIdentityLinkByPlatform(graph, 'discord', '1234567890')).toEqual(link);
  });

  it('projects identity.unlink events by removing identity indexes', () => {
    const link = identityLink();
    const chain = validChain(
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000013',
        sequence: 1,
        action: 'identity.link',
        resourceType: 'identity_link',
        resourceId: link.id,
        payload: { identityLink: link },
      }),
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000014',
        sequence: 2,
        action: 'identity.unlink',
        resourceType: 'identity_link',
        resourceId: link.id,
      }),
    );

    const graph = replayEvents(chain);

    expect(getIdentityLink(graph, link.id)).toBeUndefined();
    expect(getIdentityLinksForEntity(graph, entityId)).toEqual([]);
    expect(getIdentityLinkByPlatform(graph, 'discord', '1234567890')).toBeUndefined();
  });

  it('replays the identity link/unlink graph projection test vector', () => {
    const graph = replayEvents(identityFixture);

    expect(getIdentityLink(graph, '019e42ae-9c00-7000-8000-000000000220')).toBeUndefined();
    expect(getIdentityLinksForEntity(graph, entityId)).toEqual([]);
    expect(getIdentityLinkByPlatform(graph, 'discord', '1234567890')).toBeUndefined();
  });

  it('advances the replay cursor when a malformed event is skipped', () => {
    const chain = validChain(
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000501',
        sequence: 1,
        action: 'identity.link',
        resourceType: 'identity_link',
        resourceId: '019e42ae-9c00-7000-8000-000000000333',
        payload: { identityLink: { platform: 'discord' } },
      }),
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000502',
        sequence: 2,
        action: 'entity.create',
        resourceType: 'entity',
        resourceId: entityId,
        payload: { entity: { id: entityId, kind: 'group', name: 'After Skip', metadata: {} } },
      }),
    );
    const graph = replayEvents([chain[0]!]);

    replayEvents([chain[1]!], graph);

    expect(graph.appliedEventIds).toEqual([chain[1]!.id]);
    expect(graph.skippedEventIds).toEqual([chain[0]!.id]);
    expect(graph.lastReplayedEvent).toEqual(chain[1]);
    expect(getEntity(graph, entityId)?.name).toBe('After Skip');
  });

  it('replays graph projection JSON fixtures into deterministic snapshots', () => {
    const fixture = loadGraphProjectionFixture('comprehensive-snapshot');

    const graph = replayEvents(fixture.events);

    expect(snapshotGraphProjection(graph)).toEqual(fixture.snapshot);
  });

  it('creates deterministic JSON projection snapshots for fixtures and conformance checks', () => {
    const highEntityId = '019e42ae-9c00-7000-8000-000000000099';
    const lowEntityId = '019e42ae-9c00-7000-8000-000000000003';
    const chain = validChain(
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000701',
        sequence: 1,
        action: 'entity.create',
        resourceId: highEntityId,
        payload: { entity: { id: highEntityId, kind: 'group', name: 'High', metadata: {} } },
      }),
      eventWithoutHash({
        id: '019e42ae-9c00-7000-8000-000000000702',
        sequence: 2,
        action: 'entity.create',
        resourceId: lowEntityId,
        payload: { entity: { id: lowEntityId, kind: 'person', name: 'Low', metadata: {} } },
      }),
    );
    const graph = replayEvents(chain);

    const snapshot = snapshotGraphProjection(graph);

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot).toEqual({
      entities: [
        {
          id: lowEntityId,
          kind: 'person',
          name: 'Low',
          metadata: {},
          createdAt: '2026-05-20T00:00:00.000Z',
          updatedAt: '2026-05-20T00:00:00.000Z',
          schemaVersion: '0.1.0',
        },
        {
          id: highEntityId,
          kind: 'group',
          name: 'High',
          metadata: {},
          createdAt: '2026-05-20T00:00:00.000Z',
          updatedAt: '2026-05-20T00:00:00.000Z',
          schemaVersion: '0.1.0',
        },
      ],
      entityTombstones: [],
      edges: [],
      identityLinks: [],
      diagnostics: [],
      appliedEventIds: chain.map((event) => event.id),
      skippedEventIds: [],
      lastAppliedEventId: chain[1]!.id,
      lastReplayedEventId: chain[1]!.id,
    });
  });

  it('records diagnostics and skips projection for malformed action payloads', () => {
    const graph = projectEvent(
      createGraphProjection(),
      withEventHash(
        eventWithoutHash({
          action: 'identity.link',
          resourceType: 'identity_link',
          resourceId: '019e42ae-9c00-7000-8000-000000000333',
          payload: { identityLink: { platform: 'discord' } },
        }) as unknown as Record<string, unknown>,
      ) as unknown as Event,
    );

    expect(getIdentityLink(graph, '019e42ae-9c00-7000-8000-000000000333')).toBeUndefined();
    expect(getProjectionDiagnostics(graph)).toEqual([
      expect.objectContaining({
        code: 'invalid_event_payload',
        severity: 'error',
        action: 'identity.link',
        resourceId: '019e42ae-9c00-7000-8000-000000000333',
      }),
    ]);
    expect(graph.appliedEventIds).toEqual([]);
    expect(graph.skippedEventIds).toEqual(['019e42ae-9c00-7000-8000-000000000001']);
  });
});
