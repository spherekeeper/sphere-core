import { verifyEventChain } from '@sphere/events';
import type { Event } from '@sphere/types';

export interface EventStore {
  append(events: readonly Event[]): void;
  getEvents(chainId: string): Event[];
  getLatestEvent(chainId: string): Event | undefined;
}

export class EventStoreAppendError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EventStoreAppendError';
    this.code = code;
  }
}

export function createInMemoryEventStore(): EventStore {
  return new InMemoryEventStore();
}

class InMemoryEventStore implements EventStore {
  readonly #eventsByChainId = new Map<string, Event[]>();

  append(events: readonly Event[]): void {
    if (events.length === 0) {
      return;
    }

    const chainId = events[0]!.chainId;
    if (events.some((event) => event.chainId !== chainId)) {
      throw new EventStoreAppendError('mixed_chain_id', 'Cannot append events from multiple chains in one batch');
    }

    const stored = this.#eventsByChainId.get(chainId) ?? [];
    if (stored.length > 0) {
      const latest = stored[stored.length - 1]!;
      const first = events[0]!;
      if (first.previousHash !== latest.hash || first.sequence !== latest.sequence + 1) {
        throw new EventStoreAppendError(
          'non_contiguous_append',
          `Append does not continue stored chain ${chainId}`,
        );
      }
    }

    const candidate = [...stored, ...events];
    const verification = verifyEventChain(candidate);
    if (!verification.ok) {
      const failure = verification as Extract<typeof verification, { ok: false }>;
      throw new EventStoreAppendError(
        failure.code,
        `Cannot append invalid event chain: ${failure.code} at index ${failure.index}`,
      );
    }

    this.#eventsByChainId.set(chainId, candidate);
  }

  getEvents(chainId: string): Event[] {
    return [...(this.#eventsByChainId.get(chainId) ?? [])];
  }

  getLatestEvent(chainId: string): Event | undefined {
    const events = this.#eventsByChainId.get(chainId) ?? [];
    return events[events.length - 1];
  }
}
