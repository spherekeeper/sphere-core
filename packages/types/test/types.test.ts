import { describe, expect, it } from 'vitest';
import {
  EDGE_TYPES,
  ENTITY_KINDS,
  SPHERE_SCHEMA_VERSION,
  type Edge,
  type Entity,
  type Event,
  type IdentityLink,
} from '../src/index.js';

describe('@sphere/types', () => {
  it('exposes stable v0.1 protocol constants', () => {
    expect(SPHERE_SCHEMA_VERSION).toBe('0.1.0');
    expect(ENTITY_KINDS).toContain('person');
    expect(ENTITY_KINDS).toContain('group');
    expect(EDGE_TYPES).toContain('trusts');
    expect(EDGE_TYPES).toContain('member_of');
  });

  it('supports core entity, identity link, edge, and event shapes', () => {
    const now = '2026-05-20T00:00:00.000Z';

    const person: Entity = {
      id: '018f0000-0000-7000-8000-000000000001',
      kind: 'person',
      name: 'Example Person',
      metadata: {},
      createdAt: now,
      updatedAt: now,
      schemaVersion: SPHERE_SCHEMA_VERSION,
    };

    const identityLink: IdentityLink = {
      id: '018f0000-0000-7000-8000-000000000002',
      entityId: person.id,
      platform: 'discord',
      platformId: '1234567890',
      handle: 'example-user',
      verified: true,
      metadata: {},
      createdAt: now,
      updatedAt: now,
      schemaVersion: SPHERE_SCHEMA_VERSION,
    };

    const edge: Edge = {
      id: '018f0000-0000-7000-8000-000000000003',
      sourceId: person.id,
      targetId: '018f0000-0000-7000-8000-000000000004',
      type: 'trusts',
      metadata: { dimensions: { reliability: 0.8 } },
      createdAt: now,
      createdBy: person.id,
      schemaVersion: SPHERE_SCHEMA_VERSION,
    };

    const event: Event = {
      id: '018f0000-0000-7000-8000-000000000005',
      chainId: '018f0000-0000-7000-8000-000000000099',
      sequence: 1,
      actorId: person.id,
      subjectId: person.id,
      action: 'entity.create',
      resourceType: 'entity',
      resourceId: person.id,
      timestamp: now,
      payload: { entity: person },
      reason: null,
      schemaVersion: SPHERE_SCHEMA_VERSION,
      hashAlgorithm: 'sha256',
      previousHash: null,
      hash: 'placeholder-hash',
    };

    expect(identityLink.entityId).toBe(person.id);
    expect(edge.sourceId).toBe(person.id);
    expect(event.payload).toEqual({ entity: person });
  });
});
