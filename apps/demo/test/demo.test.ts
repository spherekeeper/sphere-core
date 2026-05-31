import { describe, expect, it } from 'vitest';

import { buildNodeApp } from '@sphere/node';
import type { Entity } from '@sphere/types';

import { runDemoFlow } from '../src/index.js';

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

describe('demo flow', () => {
  it('submits an entity command and reads it back from the graph API', async () => {
    const app = buildNodeApp({
      now: () => new Date('2026-05-28T00:00:00.000Z'),
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000010'),
    });
    const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });

    try {
      const result = await runDemoFlow({
        baseUrl,
        chainId,
        actorId,
        entityId,
        entityName: 'Ada Raver',
        entityKind: 'person',
        metadata: { crew: 'test-collective' },
        now: new Date('2026-05-28T00:00:00.000Z'),
        createId: fixedIds('019e42ae-9c00-7000-8000-000000000100'),
      });

      expect(result.submittedEvent).toMatchObject({
        sequence: 1,
        action: 'entity.create',
        resourceId: entityId,
      });
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toMatchObject<Entity>({
        id: entityId,
        kind: 'person',
        name: 'Ada Raver',
        metadata: { crew: 'test-collective' },
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        schemaVersion: '0.1.0',
      });
    } finally {
      await app.close();
    }
  });

  it('includes a bearer token on demo requests when provided', async () => {
    const app = buildNodeApp({
      bearerToken: 'test-token',
      now: () => new Date('2026-05-28T00:00:00.000Z'),
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000011'),
    });
    const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });

    try {
      const result = await runDemoFlow({
        baseUrl,
        chainId,
        actorId,
        entityId,
        entityName: 'Ada Token',
        bearerToken: 'test-token',
        now: new Date('2026-05-28T00:00:00.000Z'),
        createId: fixedIds('019e42ae-9c00-7000-8000-000000000101'),
      });

      expect(result.entities).toEqual([expect.objectContaining({ id: entityId, name: 'Ada Token' })]);
    } finally {
      await app.close();
    }
  });
});
