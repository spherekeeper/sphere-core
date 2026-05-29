# @sphere/event-store

Event store abstractions for Sphere event chains.

## Implementations

### In-memory

`createInMemoryEventStore()` is useful for tests, demos, and ephemeral reference-node runs.

### SQLite

`createSqliteEventStore({ databasePath })` persists verified event chains to SQLite while preserving the same `EventStore` interface.

```ts
import { createSqliteEventStore } from '@sphere/event-store';

const store = createSqliteEventStore({ databasePath: './sphere-events.sqlite' });
store.append(events);
store.close();
```

SQLite behavior:

- creates the event table/indexes on startup;
- stores complete event JSON by `chainId` and `sequence`;
- verifies candidate chains before inserting;
- inserts batches transactionally;
- rejects invalid/tampered/non-contiguous batches without persisting partial events.

## Shared behavior

All stores:

- append verified event-chain batches;
- enforce single-chain batches;
- enforce continuity against the stored chain tip;
- return immutable event arrays by chain id;
- return the latest event by chain id.
