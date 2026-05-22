import { describe, expect, it } from 'vitest';

import { linkEvent, withEventHash } from '@sphere/events';
import type { Event, EventWithoutHash } from '@sphere/types';

import { createInMemoryEventStore, EventStoreAppendError } from '../src/index.js';

const actorId = '019e42ae-9c00-7000-8000-000000000002';
const subjectId = '019e42ae-9c00-7000-8000-000000000003';
const entityId = '019e42ae-9c00-7000-8000-000000000004';

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

describe('@sphere/event-store', () => {
  it('appends and reads verified events by chain id', () => {
    const store = createInMemoryEventStore();
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
  });

  it('rejects appending an invalid hash chain without mutating stored events', () => {
    const store = createInMemoryEventStore();
    const chain = validChain(eventWithoutHash({ sequence: 1 }));
    const invalid = [{ ...chain[0]!, hash: 'tampered' }];

    expect(() => store.append(invalid)).toThrow(EventStoreAppendError);
    expect(store.getEvents(chain[0]!.chainId)).toEqual([]);
  });

  it('requires appended batches to continue the stored chain tip', () => {
    const store = createInMemoryEventStore();
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
  });
});
