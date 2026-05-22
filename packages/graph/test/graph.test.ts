import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Event } from '@sphere/types';
import {
  createGraphProjection,
  replayEvents,
  projectEvent,
  getEntity,
  getEdge,
  getEdgesFrom,
  getEdgesTo,
} from '../src/index.js';

const repoRoot = join(__dirname, '../../..');
const chainFixture = JSON.parse(
  readFileSync(join(repoRoot, 'specs/test-vectors/hash-chain/valid-basic-chain.json'), 'utf8'),
) as Event[];

const brokenPreviousHashFixture = JSON.parse(
  readFileSync(join(repoRoot, 'specs/test-vectors/hash-chain/invalid-broken-previous-hash.json'), 'utf8'),
) as Event[];

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
});
