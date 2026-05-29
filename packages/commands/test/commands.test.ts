import { describe, expect, it, vi } from 'vitest';

import { verifyEventChain } from '@sphere/events';
import type { Edge, Entity, Event, IdentityLink } from '@sphere/types';

import {
  createCommandEvent,
  createCommandSubmissionClient,
  createEntityCreateCommand,
  createEntityUpdateCommand,
  createIdentityLinkCommand,
  createEdgeCreateCommand,
} from '../src/index.js';

const now = new Date('2026-05-29T00:00:00.000Z');
const chainId = '019e42ae-9c00-7000-8000-000000000100';
const actorId = '019e42ae-9c00-7000-8000-000000000101';
const entityId = '019e42ae-9c00-7000-8000-000000000102';
const identityLinkId = '019e42ae-9c00-7000-8000-000000000103';
const edgeId = '019e42ae-9c00-7000-8000-000000000104';

function fixedIds(...ids: string[]) {
  let index = 0;
  return () => {
    const id = ids[index];
    if (id === undefined) {
      throw new Error('No test id available');
    }
    index += 1;
    return id;
  };
}

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: entityId,
    kind: 'group',
    name: 'Sphere Core Builders',
    metadata: { city: 'Berlin' },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    schemaVersion: '0.1.0',
    ...overrides,
  };
}

function identityLink(overrides: Partial<IdentityLink> = {}): IdentityLink {
  return {
    id: identityLinkId,
    entityId,
    platform: 'discord',
    platformId: '1234567890',
    handle: 'spherebuilder',
    verified: true,
    metadata: {},
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    schemaVersion: '0.1.0',
    ...overrides,
  };
}

function edge(overrides: Partial<Edge> = {}): Edge {
  return {
    id: edgeId,
    sourceId: actorId,
    targetId: entityId,
    type: 'member_of',
    metadata: { role: 'organizer' },
    createdAt: now.toISOString(),
    createdBy: actorId,
    schemaVersion: '0.1.0',
    ...overrides,
  };
}

describe('@sphere/commands', () => {
  it('creates typed commands for common graph mutations', () => {
    const create = createEntityCreateCommand({ actorId, entity: entity(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000201') });
    const update = createEntityUpdateCommand({
      actorId,
      entityId,
      patch: { name: 'Updated', metadata: { focus: 'protocol' } },
      reason: 'profile edit',
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000202'),
    });
    const link = createIdentityLinkCommand({ actorId, identityLink: identityLink(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000203') });
    const createEdge = createEdgeCreateCommand({ actorId, edge: edge(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000204') });

    expect(create).toMatchObject({ action: 'entity.create', resourceType: 'entity', resourceId: entityId, payload: { entity: entity() } });
    expect(update).toMatchObject({ action: 'entity.update', resourceType: 'entity', resourceId: entityId, payload: { entity: { name: 'Updated', metadata: { focus: 'protocol' } } }, reason: 'profile edit' });
    expect(link).toMatchObject({ action: 'identity.link', resourceType: 'identity_link', resourceId: identityLinkId, payload: { identityLink: identityLink() } });
    expect(createEdge).toMatchObject({ action: 'edge.create', resourceType: 'edge', resourceId: edgeId, payload: { edge: edge() } });
  });

  it('turns commands into hash-linked events', () => {
    const firstCommand = createEntityCreateCommand({ actorId, entity: entity(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000201') });
    const first = createCommandEvent({
      command: firstCommand,
      chainId,
      sequence: 1,
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000301'),
    });
    const secondCommand = createEntityUpdateCommand({ actorId, entityId, patch: { name: 'Updated' }, now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000202') });
    const second = createCommandEvent({
      command: secondCommand,
      chainId,
      sequence: 2,
      previousEvent: first,
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000302'),
    });

    expect(first).toMatchObject({
      id: '019e42ae-9c00-7000-8000-000000000301',
      chainId,
      sequence: 1,
      actorId,
      subjectId: entityId,
      action: 'entity.create',
      resourceType: 'entity',
      resourceId: entityId,
      payload: { entity: entity(), command: firstCommand },
      previousHash: null,
    });
    expect(second.previousHash).toBe(first.hash);
    expect(verifyEventChain([first, second])).toEqual({ ok: true, events: 2 });
  });

  it('submits generated command events to a Sphere node', async () => {
    const firstCommand = createEntityCreateCommand({ actorId, entity: entity(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000201') });
    const first = createCommandEvent({ command: firstCommand, chainId, sequence: 1, now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000301') });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ appended: 1, chainId, latestSequence: 1 }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const client = createCommandSubmissionClient({ baseUrl: 'http://127.0.0.1:3080', fetch });

    await expect(client.submitEvents({ chainId, events: [first] })).resolves.toEqual({ appended: 1, chainId, latestSequence: 1 });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000100/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [first] }),
    });
  });

  it('submits commands directly to a Sphere node', async () => {
    const command = createEntityCreateCommand({ actorId, entity: entity(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000201') });
    const event = createCommandEvent({ command, chainId, sequence: 1, now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000301') });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ accepted: true, chainId, event }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const client = createCommandSubmissionClient({ baseUrl: 'http://127.0.0.1:3080/', fetch });

    await expect(client.submitCommand({ chainId, command })).resolves.toEqual({ accepted: true, chainId, event });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000100/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command }),
    });
  });

  it('surfaces non-2xx node submission errors with response details', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'event_store_append_failed', code: 'event_hash_mismatch' }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const client = createCommandSubmissionClient({ baseUrl: 'http://node.local/', fetch });

    await expect(client.submitEvents({ chainId, events: [] })).rejects.toMatchObject({
      name: 'CommandSubmissionError',
      status: 400,
      details: { error: 'event_store_append_failed', code: 'event_hash_mismatch' },
    });
  });

  it('surfaces non-2xx direct command submission errors with response details', async () => {
    const command = createEntityCreateCommand({ actorId, entity: entity(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000201') });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_command_body' }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const client = createCommandSubmissionClient({ baseUrl: 'http://node.local/', fetch });

    await expect(client.submitCommand({ chainId, command })).rejects.toMatchObject({
      name: 'CommandSubmissionError',
      status: 400,
      details: { error: 'invalid_command_body' },
    });
  });
});
