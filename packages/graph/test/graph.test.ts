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
  getIdentityLink,
  getIdentityLinksForEntity,
  getIdentityLinkByPlatform,
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
  });
});
