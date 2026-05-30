import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { linkEvent, withEventHash } from '@sphere/events';
import type { Event, EventWithoutHash } from '@sphere/types';

import {
  createInMemoryEventStore,
  createSqliteEventStore,
  EventStoreAppendError,
  getEventStoreMetadata,
  type CloseableEventStore,
  type EventStore,
} from '../src/index.js';

const actorId = '019e42ae-9c00-7000-8000-000000000002';
const subjectId = '019e42ae-9c00-7000-8000-000000000003';
const entityId = '019e42ae-9c00-7000-8000-000000000004';

interface StoreCase {
  name: string;
  expectedStorage: 'memory' | 'sqlite';
  createStore(): { store: EventStore; cleanup(): void };
}

const storeCases: StoreCase[] = [
  {
    name: 'in-memory',
    expectedStorage: 'memory',
    createStore: () => ({ store: createInMemoryEventStore(), cleanup: () => undefined }),
  },
  {
    name: 'SQLite',
    expectedStorage: 'sqlite',
    createStore: () => {
      const store = createSqliteEventStore({ databasePath: ':memory:' });
      return { store, cleanup: () => store.close() };
    },
  },
];

function eventWithoutHash(overrides: Partial<EventWithoutHash>): EventWithoutHash {
  return {
    id: overrides.id ?? `019e42ae-9c00-7000-8000-${String(overrides.sequence ?? 1).padStart(12, '0')}`,
    chainId: overrides.chainId ?? '019e42ae-9c00-7000-8000-000000000099',
    sequence: overrides.sequence ?? 1,
    actorId,
    subjectId,
    action: overrides.action ?? 'entity.create',
    resourceType: overrides.resourceType ?? 'entity',
    resourceId: overrides.resourceId ?? entityId,
    timestamp: overrides.timestamp ?? '2026-05-20T00:00:00.000Z',
    payload: overrides.payload ?? { entity: { kind: 'group', name: 'Sphere Core Builders' } },
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

function threeEventChain(): Event[] {
  return validChain(
    eventWithoutHash({ sequence: 1 }),
    eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000005', sequence: 2, action: 'entity.update' }),
    eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000006', sequence: 3, action: 'entity.delete' }),
  );
}

function withStore(testCase: StoreCase, run: (store: EventStore) => void): void {
  const { store, cleanup } = testCase.createStore();
  try {
    run(store);
  } finally {
    cleanup();
  }
}

describe('@sphere/event-store conformance', () => {
  for (const testCase of storeCases) {
    describe(testCase.name, () => {
      it('reports implementation metadata and empty-store defaults', () => withStore(testCase, (store) => {
        expect(getEventStoreMetadata(store)).toEqual({ storage: testCase.expectedStorage });
        expect(store.getEvents('missing-chain')).toEqual([]);
        expect(store.getEventsAfter('missing-chain', 0)).toEqual([]);
        expect(store.getEventsRange('missing-chain', { afterSequence: 10, limit: 2 })).toEqual([]);
        expect(store.getLatestEvent('missing-chain')).toBeUndefined();
      }));

      it('treats empty append batches as no-ops', () => withStore(testCase, (store) => {
        const chain = threeEventChain();

        store.append([]);
        expect(store.getEvents(chain[0]!.chainId)).toEqual([]);

        store.append(chain);
        store.append([]);
        expect(store.getEvents(chain[0]!.chainId)).toEqual(chain);
        expect(store.getLatestEvent(chain[0]!.chainId)).toEqual(chain[2]);
      }));

      it('appends and reads verified events by chain id', () => withStore(testCase, (store) => {
        const chain = validChain(
          eventWithoutHash({ sequence: 1 }),
          eventWithoutHash({
            id: '019e42ae-9c00-7000-8000-000000000005',
            sequence: 2,
            action: 'entity.update',
            payload: { entity: { name: 'Updated' } },
          }),
        );

        store.append(chain);

        expect(store.getEvents(chain[0]!.chainId)).toEqual(chain);
        expect(store.getLatestEvent(chain[0]!.chainId)).toEqual(chain[1]);
      }));

      it('rejects appending an invalid hash chain without mutating stored events', () => withStore(testCase, (store) => {
        const chain = validChain(eventWithoutHash({ sequence: 1 }));
        const invalid = [{ ...chain[0]!, hash: 'tampered' }];

        expect(() => store.append(invalid)).toThrow(EventStoreAppendError);
        expect(store.getEvents(chain[0]!.chainId)).toEqual([]);
      }));

      it('rejects duplicate event ids without mutating stored events', () => withStore(testCase, (store) => {
        const [first, second] = validChain(
          eventWithoutHash({ sequence: 1 }),
          eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000005', sequence: 2 }),
        );
        const duplicateIdSecond = linkEvent(
          first!,
          eventWithoutHash({ id: first!.id, sequence: 2 }) as unknown as Record<string, unknown>,
        ) as unknown as Event;
        const otherChainDuplicate = validChain(eventWithoutHash({
          id: first!.id,
          chainId: '019e42ae-9c00-7000-8000-000000000199',
          sequence: 1,
        }));

        expect(() => store.append([first!, duplicateIdSecond])).toThrow(/duplicate event id/);
        expect(store.getEvents(first!.chainId)).toEqual([]);

        store.append([first!, second!]);
        expect(() => store.append(otherChainDuplicate)).toThrow(/duplicate event id/);
        expect(store.getEvents(first!.chainId)).toEqual([first, second]);
        expect(store.getEvents(otherChainDuplicate[0]!.chainId)).toEqual([]);
      }));

      it('rejects mixed-chain batches without mutating either chain', () => withStore(testCase, (store) => {
        const [first, second] = validChain(
          eventWithoutHash({ sequence: 1 }),
          eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000005', sequence: 2 }),
        );
        const otherChainEvent = validChain(eventWithoutHash({
          id: '019e42ae-9c00-7000-8000-000000000105',
          chainId: '019e42ae-9c00-7000-8000-000000000199',
          sequence: 1,
        }))[0]!;

        expect(() => store.append([first!, otherChainEvent])).toThrow(/multiple chains/);
        expect(store.getEvents(first!.chainId)).toEqual([]);
        expect(store.getEvents(otherChainEvent.chainId)).toEqual([]);

        store.append([first!]);
        expect(() => store.append([second!, otherChainEvent])).toThrow(/multiple chains/);
        expect(store.getEvents(first!.chainId)).toEqual([first]);
        expect(store.getEvents(otherChainEvent.chainId)).toEqual([]);
      }));

      it('requires appended batches to continue the stored chain tip', () => withStore(testCase, (store) => {
        const [first, second] = validChain(
          eventWithoutHash({ sequence: 1 }),
          eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000005', sequence: 2 }),
        );
        const competingSecond = withEventHash(
          eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000006', sequence: 2 }) as unknown as Record<string, unknown>,
        ) as unknown as Event;

        store.append([first!]);

        expect(() => store.append([competingSecond])).toThrow(/does not continue stored chain/);
        expect(store.getEvents(first!.chainId)).toEqual([first]);
        store.append([second!]);
        expect(store.getLatestEvent(first!.chainId)).toEqual(second);
      }));

      it('does not mix chains when reading events after a sequence', () => withStore(testCase, (store) => {
        const chain = threeEventChain();
        const otherChain = validChain(eventWithoutHash({
          id: '019e42ae-9c00-7000-8000-000000000105',
          chainId: '019e42ae-9c00-7000-8000-000000000199',
          sequence: 1,
        }));

        store.append(chain);
        store.append(otherChain);

        expect(store.getEventsAfter(chain[0]!.chainId, 1)).toEqual([chain[1], chain[2]]);
        expect(store.getEventsAfter(otherChain[0]!.chainId, 0)).toEqual(otherChain);
      }));

      it('reads bounded event ranges after an exclusive sequence', () => withStore(testCase, (store) => {
        const chain = threeEventChain();

        store.append(chain);

        expect(store.getEventsRange(chain[0]!.chainId, { afterSequence: 1, limit: 1 })).toEqual([chain[1]]);
        expect(store.getEventsRange(chain[0]!.chainId, { afterSequence: 2 })).toEqual([chain[2]]);
        expect(store.getEventsRange(chain[0]!.chainId, { limit: 2 })).toEqual([chain[0], chain[1]]);
        expect(store.getEventsRange(chain[0]!.chainId, { afterSequence: 3, limit: 1 })).toEqual([]);
      }));

      it('rejects invalid range options', () => withStore(testCase, (store) => {
        expect(() => store.getEventsRange('chain', { afterSequence: -1 })).toThrow(/afterSequence/);
        expect(() => store.getEventsRange('chain', { limit: 0 })).toThrow(/limit/);
      }));
    });
  }
});

describe('@sphere/event-store SQLite persistence', () => {
  it('persists verified chains across SQLite event store instances', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sphere-event-store-'));
    const databasePath = join(tempDir, 'events.sqlite');
    const chain = validChain(
      eventWithoutHash({ sequence: 1 }),
      eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000005', sequence: 2, action: 'entity.update' }),
    );

    try {
      const writer = createSqliteEventStore({ databasePath });
      writer.append(chain);
      writer.close();

      const reader = createSqliteEventStore({ databasePath });
      expect(reader.getEvents(chain[0]!.chainId)).toEqual(chain);
      expect(reader.getLatestEvent(chain[0]!.chainId)).toEqual(chain[1]);
      expect(reader.getEventsAfter(chain[0]!.chainId, 1)).toEqual([chain[1]]);
      reader.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid SQLite appends without persisting partial events', () => {
    const store = createSqliteEventStore({ databasePath: ':memory:' });
    const [first, second] = validChain(
      eventWithoutHash({ sequence: 1 }),
      eventWithoutHash({ id: '019e42ae-9c00-7000-8000-000000000005', sequence: 2 }),
    );
    const invalidSecond = { ...second!, previousHash: 'broken' };

    expect(() => store.append([first!, invalidSecond])).toThrow(EventStoreAppendError);
    expect(store.getEvents(first!.chainId)).toEqual([]);
    store.close();
  });
});
