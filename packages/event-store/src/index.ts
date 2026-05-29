import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';

import { verifyEventChain } from '@sphere/events';
import type { Event } from '@sphere/types';

export interface EventStore {
  append(events: readonly Event[]): void;
  getEvents(chainId: string): Event[];
  getLatestEvent(chainId: string): Event | undefined;
}

export interface CloseableEventStore extends EventStore {
  close(): void;
}

export interface EventStoreMetadata {
  storage: 'memory' | 'sqlite';
}

export interface SqliteEventStoreOptions {
  databasePath: string;
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

export function createSqliteEventStore(options: SqliteEventStoreOptions): CloseableEventStore {
  return new SqliteEventStore(options.databasePath);
}

export function getEventStoreMetadata(eventStore: EventStore): EventStoreMetadata {
  if (eventStore instanceof SqliteEventStore) {
    return { storage: 'sqlite' };
  }
  return { storage: 'memory' };
}

class InMemoryEventStore implements EventStore {
  readonly #eventsByChainId = new Map<string, Event[]>();

  append(events: readonly Event[]): void {
    appendEvents({
      incoming: events,
      stored: events.length === 0 ? [] : (this.#eventsByChainId.get(events[0]!.chainId) ?? []),
      persist: (candidate) => {
        if (events.length > 0) {
          this.#eventsByChainId.set(events[0]!.chainId, candidate);
        }
      },
    });
  }

  getEvents(chainId: string): Event[] {
    return [...(this.#eventsByChainId.get(chainId) ?? [])];
  }

  getLatestEvent(chainId: string): Event | undefined {
    const events = this.#eventsByChainId.get(chainId) ?? [];
    return events[events.length - 1];
  }
}

class SqliteEventStore implements CloseableEventStore {
  readonly #database: SqliteDatabase;

  constructor(databasePath: string) {
    this.#database = new Database(databasePath);
    this.#database.pragma('journal_mode = WAL');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS events (
        chain_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        event_json TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chain_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_events_chain_id_sequence ON events(chain_id, sequence);
    `);
  }

  append(events: readonly Event[]): void {
    if (events.length === 0) {
      return;
    }

    const chainId = events[0]!.chainId;
    const stored = this.getEvents(chainId);
    const candidate = appendEvents({
      incoming: events,
      stored,
      persist: (verifiedCandidate) => {
        const toInsert = verifiedCandidate.slice(stored.length);
        const insert = this.#database.prepare(`
          INSERT INTO events (chain_id, sequence, event_id, event_json, hash)
          VALUES (@chainId, @sequence, @id, @eventJson, @hash)
        `);
        const transaction = this.#database.transaction((batch: readonly Event[]) => {
          for (const event of batch) {
            insert.run({
              chainId: event.chainId,
              sequence: event.sequence,
              id: event.id,
              eventJson: JSON.stringify(event),
              hash: event.hash,
            });
          }
        });
        transaction(toInsert);
      },
    });

    // Keep TypeScript aware that appendEvents validated the candidate before persistence.
    void candidate;
  }

  getEvents(chainId: string): Event[] {
    const rows = this.#database
      .prepare('SELECT event_json AS eventJson FROM events WHERE chain_id = ? ORDER BY sequence ASC')
      .all(chainId) as Array<{ eventJson: string }>;
    return rows.map((row) => JSON.parse(row.eventJson) as Event);
  }

  getLatestEvent(chainId: string): Event | undefined {
    const row = this.#database
      .prepare('SELECT event_json AS eventJson FROM events WHERE chain_id = ? ORDER BY sequence DESC LIMIT 1')
      .get(chainId) as { eventJson: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.eventJson) as Event);
  }

  close(): void {
    this.#database.close();
  }
}

interface AppendEventsOptions {
  incoming: readonly Event[];
  stored: readonly Event[];
  persist(candidate: Event[]): void;
}

function appendEvents(options: AppendEventsOptions): Event[] {
  const { incoming, stored, persist } = options;

  if (incoming.length === 0) {
    return [...stored];
  }

  const chainId = incoming[0]!.chainId;
  if (incoming.some((event) => event.chainId !== chainId)) {
    throw new EventStoreAppendError('mixed_chain_id', 'Cannot append events from multiple chains in one batch');
  }

  if (stored.length > 0) {
    const latest = stored[stored.length - 1]!;
    const first = incoming[0]!;
    if (first.previousHash !== latest.hash || first.sequence !== latest.sequence + 1) {
      throw new EventStoreAppendError('non_contiguous_append', `Append does not continue stored chain ${chainId}`);
    }
  }

  const candidate = [...stored, ...incoming];
  const verification = verifyEventChain(candidate);
  if (!verification.ok) {
    const failure = verification as Extract<typeof verification, { ok: false }>;
    throw new EventStoreAppendError(
      failure.code,
      `Cannot append invalid event chain: ${failure.code} at index ${failure.index}`,
    );
  }

  persist(candidate);
  return candidate;
}
