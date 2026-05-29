import { describe, expect, it } from 'vitest';

import {
  createEntityCreateCommand,
  createEntityUpdateCommand,
} from '@sphere/commands';
import { createSqliteEventStore } from '@sphere/event-store';
import { linkEvent, withEventHash } from '@sphere/events';
import type { Event, EventWithoutHash } from '@sphere/types';

import { buildNodeApp } from '../src/index.js';

const schemaVersion = '0.1.0' as const;
const chainId = '019e42ae-9c00-7000-8000-000000000000';
const actorId = '019e42ae-9c00-7000-8000-000000000001';
const entityId = '019e42ae-9c00-7000-8000-000000000002';

function fixedIds(...ids: string[]) {
  let index = 0;
  return () => {
    const id = ids[index];
    if (id === undefined) {
      throw new Error('No fixed test id available');
    }
    index += 1;
    return id;
  };
}

function baseEvent(overrides: Partial<EventWithoutHash>): EventWithoutHash {
  return {
    id: '019e42ae-9c00-7000-8000-000000000010',
    chainId,
    sequence: 1,
    actorId,
    subjectId: entityId,
    action: 'entity.create',
    resourceType: 'entity',
    resourceId: entityId,
    timestamp: '2026-05-28T00:00:00.000Z',
    payload: {
      entity: {
        id: entityId,
        kind: 'person',
        name: 'Ada Raver',
        metadata: { crew: 'test-collective' },
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        schemaVersion,
      },
    },
    reason: null,
    hashAlgorithm: 'sha256',
    previousHash: null,
    schemaVersion,
    ...overrides,
  };
}

function entityCreateEvent(): Event {
  return withEventHash(baseEvent({}) as unknown as Record<string, unknown>) as unknown as Event;
}

function entityUpdateEvent(previous: Event): Event {
  return linkEvent(
    previous,
    baseEvent({
      id: '019e42ae-9c00-7000-8000-000000000011',
      sequence: 2,
      action: 'entity.update',
      payload: {
        entity: {
          name: 'Ada Updated',
          metadata: { role: 'organizer' },
        },
      },
    }) as unknown as Record<string, unknown>,
  ) as unknown as Event;
}

describe('Sphere reference node API', () => {
  it('reports health and node info', async () => {
    const app = buildNodeApp();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const info = await app.inject({ method: 'GET', url: '/node/info' });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({
      name: 'sphere-reference-node',
      schemaVersion,
      storage: 'memory',
    });
  });

  it('reports SQLite storage when configured with a SQLite event store', async () => {
    const store = createSqliteEventStore({ databasePath: ':memory:' });
    const app = buildNodeApp({ eventStore: store });

    const info = await app.inject({ method: 'GET', url: '/node/info' });

    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ storage: 'sqlite' });
    store.close();
  });

  it('appends verified chain events and returns projected entity state', async () => {
    const app = buildNodeApp();
    const first = entityCreateEvent();
    const second = entityUpdateEvent(first);

    const append = await app.inject({
      method: 'POST',
      url: `/chains/${chainId}/events`,
      payload: { events: [first, second] },
    });

    expect(append.statusCode).toBe(201);
    expect(append.json()).toEqual({ appended: 2, chainId, latestSequence: 2 });

    const events = await app.inject({ method: 'GET', url: `/chains/${chainId}/events` });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toEqual({ chainId, events: [first, second] });

    const entity = await app.inject({ method: 'GET', url: `/chains/${chainId}/graph/entities/${entityId}` });
    expect(entity.statusCode).toBe(200);
    expect(entity.json()).toMatchObject({
      id: entityId,
      name: 'Ada Updated',
      metadata: { crew: 'test-collective', role: 'organizer' },
    });
  });

  it('rejects invalid append batches without mutating stored events', async () => {
    const app = buildNodeApp();
    const first = entityCreateEvent();
    const invalidSecond = {
      ...entityUpdateEvent(first),
      previousHash: 'not-the-previous-hash',
    };

    const append = await app.inject({
      method: 'POST',
      url: `/chains/${chainId}/events`,
      payload: { events: [first, invalidSecond] },
    });

    expect(append.statusCode).toBe(400);
    expect(append.json()).toMatchObject({
      error: 'event_store_append_failed',
      code: 'event_hash_mismatch',
    });

    const events = await app.inject({ method: 'GET', url: `/chains/${chainId}/events` });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toEqual({ chainId, events: [] });
  });

  it('accepts commands and appends generated events at the chain tip', async () => {
    const now = new Date('2026-05-28T00:00:00.000Z');
    const app = buildNodeApp({
      now: () => now,
      createId: fixedIds(
        '019e42ae-9c00-7000-8000-000000000012',
        '019e42ae-9c00-7000-8000-000000000013',
      ),
    });
    const createCommand = createEntityCreateCommand({
      actorId,
      entity: {
        id: entityId,
        kind: 'person',
        name: 'Ada Raver',
        metadata: { crew: 'test-collective' },
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        schemaVersion,
      },
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000112'),
    });
    const updateCommand = createEntityUpdateCommand({
      actorId,
      entityId,
      patch: { name: 'Ada Commanded', metadata: { role: 'organizer' } },
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000113'),
    });

    const createResponse = await app.inject({
      method: 'POST',
      url: `/chains/${chainId}/commands`,
      payload: { command: createCommand },
    });
    const updateResponse = await app.inject({
      method: 'POST',
      url: `/chains/${chainId}/commands`,
      payload: { command: updateCommand },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({ accepted: true, chainId, event: { sequence: 1, action: 'entity.create' } });
    expect(updateResponse.statusCode).toBe(201);
    expect(updateResponse.json()).toMatchObject({ accepted: true, chainId, event: { sequence: 2, action: 'entity.update' } });

    const events = await app.inject({ method: 'GET', url: `/chains/${chainId}/events` });
    expect(events.json().events).toHaveLength(2);
    expect(events.json().events[1].previousHash).toBe(events.json().events[0].hash);

    const entity = await app.inject({ method: 'GET', url: `/chains/${chainId}/graph/entities/${entityId}` });
    expect(entity.json()).toMatchObject({
      id: entityId,
      name: 'Ada Commanded',
      metadata: { crew: 'test-collective', role: 'organizer' },
    });
  });

  it('accepts commands and exposes active entities as a read model', async () => {
    const now = new Date('2026-05-28T00:00:00.000Z');
    const secondEntityId = '019e42ae-9c00-7000-8000-000000000099';
    const app = buildNodeApp({
      now: () => now,
      createId: fixedIds(
        '019e42ae-9c00-7000-8000-000000000014',
        '019e42ae-9c00-7000-8000-000000000015',
      ),
    });
    const firstCommand = createEntityCreateCommand({
      actorId,
      entity: {
        id: entityId,
        kind: 'person',
        name: 'Ada Raver',
        metadata: { crew: 'test-collective' },
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        schemaVersion,
      },
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000114'),
    });
    const secondCommand = createEntityCreateCommand({
      actorId,
      entity: {
        id: secondEntityId,
        kind: 'group',
        name: 'Bass Collective',
        metadata: { city: 'Berlin' },
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        schemaVersion,
      },
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000115'),
    });

    await app.inject({ method: 'POST', url: `/chains/${chainId}/commands`, payload: { command: secondCommand } });
    await app.inject({ method: 'POST', url: `/chains/${chainId}/commands`, payload: { command: firstCommand } });

    const response = await app.inject({ method: 'GET', url: `/chains/${chainId}/graph/entities` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      chainId,
      entities: [
        expect.objectContaining({ id: entityId, name: 'Ada Raver' }),
        expect.objectContaining({ id: secondEntityId, name: 'Bass Collective' }),
      ],
    });
  });

  it('rejects invalid command request bodies without appending events', async () => {
    const app = buildNodeApp();

    const response = await app.inject({
      method: 'POST',
      url: `/chains/${chainId}/commands`,
      payload: { command: { action: 'entity.create' } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_command_body' });
    const events = await app.inject({ method: 'GET', url: `/chains/${chainId}/events` });
    expect(events.json()).toEqual({ chainId, events: [] });
  });

  it('returns 404 for missing projected entities', async () => {
    const app = buildNodeApp();

    const response = await app.inject({ method: 'GET', url: `/chains/${chainId}/graph/entities/${entityId}` });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'entity_not_found', id: entityId });
  });
});
