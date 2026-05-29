import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';

import { verifyEventChain } from '@sphere/events';
import type { Event } from '@sphere/types';

export interface EventStore {
  append(events: readonly Event[]): void;
  getEvents(chainId: string): Event[];
  getEventsAfter(chainId: string, sequence: number): Event[];
  getEventsRange(chainId: string, options?: EventStoreRangeOptions): Event[];
  getLatestEvent(chainId: string): Event | undefined;
}

export interface EventStoreRangeOptions {
  afterSequence?: number;
  limit?: number;
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
  readonly #eventIds = new Set<string>();

  append(events: readonly Event[]): void {
    appendEvents({
      incoming: events,
      stored: events.length === 0 ? [] : (this.#eventsByChainId.get(events[0]!.chainId) ?? []),
      eventExists: (eventId) => this.#eventIds.has(eventId),
      persist: (candidate) => {
        for (const event of events) {
          this.#eventIds.add(event.id);
        }
        if (events.length > 0) {
          this.#eventsByChainId.set(events[0]!.chainId, candidate);
        }
      },
    });
  }

  getEvents(chainId: string): Event[] {
    return this.getEventsRange(chainId);
  }

  getEventsAfter(chainId: string, sequence: number): Event[] {
    return this.getEventsRange(chainId, { afterSequence: sequence });
  }

  getEventsRange(chainId: string, options: EventStoreRangeOptions = {}): Event[] {
    const { afterSequence, limit } = normalizeRangeOptions(options);
    const events = this.#eventsByChainId.get(chainId) ?? [];
    const filtered = afterSequence === undefined
      ? events
      : events.filter((event) => event.sequence > afterSequence);
    return limit === undefined ? [...filtered] : filtered.slice(0, limit);
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
      eventExists: (eventId) => this.hasEventId(eventId),
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
    return this.getEventsRange(chainId);
  }

  getEventsAfter(chainId: string, sequence: number): Event[] {
    return this.getEventsRange(chainId, { afterSequence: sequence });
  }

  getEventsRange(chainId: string, options: EventStoreRangeOptions = {}): Event[] {
    const { afterSequence, limit } = normalizeRangeOptions(options);
    const whereClause = afterSequence === undefined ? '' : ' AND sequence > @afterSequence';
    const limitClause = limit === undefined ? '' : ' LIMIT @limit';
    const rows = this.#database
      .prepare(`SELECT event_json AS eventJson FROM events WHERE chain_id = @chainId${whereClause} ORDER BY sequence ASC${limitClause}`)
      .all({ chainId, afterSequence, limit }) as Array<{ eventJson: string }>;
    return rows.map((row) => JSON.parse(row.eventJson) as Event);
  }

  getLatestEvent(chainId: string): Event | undefined {
    const row = this.#database
      .prepare('SELECT event_json AS eventJson FROM events WHERE chain_id = ? ORDER BY sequence DESC LIMIT 1')
      .get(chainId) as { eventJson: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.eventJson) as Event);
  }

  hasEventId(eventId: string): boolean {
    const row = this.#database
      .prepare('SELECT 1 FROM events WHERE event_id = ? LIMIT 1')
      .get(eventId) as { 1: number } | undefined;
    return row !== undefined;
  }

  close(): void {
    this.#database.close();
  }
}

interface AppendEventsOptions {
  incoming: readonly Event[];
  stored: readonly Event[];
  eventExists(eventId: string): boolean;
  persist(candidate: Event[]): void;
}

interface NormalizedRangeOptions {
  afterSequence?: number;
  limit?: number;
}

function normalizeRangeOptions(options: EventStoreRangeOptions): NormalizedRangeOptions {
  const normalized: NormalizedRangeOptions = {};
  if (options.afterSequence !== undefined) {
    if (!Number.isInteger(options.afterSequence) || options.afterSequence < 0) {
      throw new RangeError('afterSequence must be a non-negative integer');
    }
    normalized.afterSequence = options.afterSequence;
  }
  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new RangeError('limit must be a positive integer');
    }
    normalized.limit = options.limit;
  }
  return normalized;
}

function appendEvents(options: AppendEventsOptions): Event[] {
  const { incoming, stored, eventExists, persist } = options;

  if (incoming.length === 0) {
    return [...stored];
  }

  const chainId = incoming[0]!.chainId;
  if (incoming.some((event) => event.chainId !== chainId)) {
    throw new EventStoreAppendError('mixed_chain_id', 'Cannot append events from multiple chains in one batch');
  }

  const incomingIds = new Set<string>();
  for (const event of incoming) {
    if (incomingIds.has(event.id)) {
      throw new EventStoreAppendError('duplicate_event_id', `Cannot append duplicate event id ${event.id} in one batch`);
    }
    incomingIds.add(event.id);
    if (eventExists(event.id)) {
      throw new EventStoreAppendError('duplicate_event_id', `Cannot append duplicate event id ${event.id}`);
    }
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
