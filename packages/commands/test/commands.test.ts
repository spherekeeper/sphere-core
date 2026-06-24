import { describe, expect, it, vi } from 'vitest';

import { verifyEventChain } from '@sphere/events';
import type { Edge, Entity, Event, IdentityLink } from '@sphere/types';

import {
  createCommandEvent,
  createCommandSubmissionClient,
  createNodeReadClient,
  createEntityCreateCommand,
  createEntityUpdateCommand,
  createIdentityLinkCommand,
  createIdentityUnlinkCommand,
  createEdgeCreateCommand,
  createEdgeDeleteCommand,
  createEntityDeleteCommand,
  validateCommandPolicy,
  CommandPolicyError,
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
    const unlink = createIdentityUnlinkCommand({
      actorId,
      identityLinkId,
      reason: 'account disconnected',
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000213'),
    });
    const createEdge = createEdgeCreateCommand({ actorId, edge: edge(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000204') });
    const deleteEdge = createEdgeDeleteCommand({
      actorId,
      edgeId,
      reason: 'relationship removed',
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000214'),
    });
    const deleteEntity = createEntityDeleteCommand({
      actorId,
      entityId,
      reason: 'profile removed',
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000215'),
    });

    expect(create).toMatchObject({ action: 'entity.create', resourceType: 'entity', resourceId: entityId, payload: { entity: entity() } });
    expect(update).toMatchObject({ action: 'entity.update', resourceType: 'entity', resourceId: entityId, payload: { entity: { name: 'Updated', metadata: { focus: 'protocol' } } }, reason: 'profile edit' });
    expect(link).toMatchObject({ action: 'identity.link', resourceType: 'identity_link', resourceId: identityLinkId, payload: { identityLink: identityLink() } });
    expect(unlink).toMatchObject({ action: 'identity.unlink', resourceType: 'identity_link', resourceId: identityLinkId, payload: {}, reason: 'account disconnected' });
    expect(createEdge).toMatchObject({ action: 'edge.create', resourceType: 'edge', resourceId: edgeId, payload: { edge: edge() } });
    expect(deleteEdge).toMatchObject({ action: 'edge.delete', resourceType: 'edge', resourceId: edgeId, payload: {}, reason: 'relationship removed' });
    expect(deleteEntity).toMatchObject({ action: 'entity.delete', resourceType: 'entity', resourceId: entityId, payload: {}, reason: 'profile removed' });
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

  it('validates known command action policy contracts before event creation', () => {
    const valid = createEntityCreateCommand({ actorId, entity: entity(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000205') });
    const mismatchedResource = {
      ...valid,
      resourceId: '019e42ae-9c00-7000-8000-000000000999',
    };
    const missingPayload = {
      ...valid,
      payload: {},
    };

    expect(validateCommandPolicy(valid)).toEqual({ ok: true });
    expect(validateCommandPolicy(mismatchedResource)).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: 'resource_id_mismatch', path: '/resourceId' })],
    });
    expect(validateCommandPolicy(missingPayload)).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: 'missing_payload_object', path: '/payload/entity' })],
    });
    const unsupportedAction = {
      ...valid,
      action: 'entity.rename',
      payload: { entity: { name: 'Renamed' } },
    } as unknown as Parameters<typeof validateCommandPolicy>[0];
    expect(validateCommandPolicy(unsupportedAction)).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: 'unsupported_action', path: '/action' })],
    });
    expect(() => createCommandEvent({
      command: mismatchedResource,
      chainId,
      sequence: 1,
      now,
      createId: fixedIds('019e42ae-9c00-7000-8000-000000000305'),
    })).toThrow(CommandPolicyError);
  });

  it('keeps custom commands policy-open for app-specific handlers', () => {
    expect(validateCommandPolicy({
      id: '019e42ae-9c00-7000-8000-000000000206',
      actorId,
      action: 'custom:festival.rsvp',
      resourceType: 'custom:event_registration',
      resourceId: '019e42ae-9c00-7000-8000-000000000207',
      payload: { response: 'yes' },
      reason: null,
      createdAt: now.toISOString(),
      schemaVersion: '0.1.0',
    })).toEqual({ ok: true });
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
    const client = createCommandSubmissionClient({ baseUrl: 'http://127.0.0.1:3080/', bearerToken: 'dev-secret', fetch });

    await expect(client.submitCommand({ chainId, command })).resolves.toEqual({ accepted: true, chainId, event });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000100/commands', {
      method: 'POST',
      headers: { 'authorization': 'Bearer dev-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ command }),
    });
  });

  it('submits event batches directly to a Sphere node', async () => {
    const command = createEntityCreateCommand({ actorId, entity: entity(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000202') });
    const event = createCommandEvent({ command, chainId, sequence: 1, now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000302') });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ appended: 1, chainId, latestSequence: 1 }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const client = createCommandSubmissionClient({ baseUrl: 'http://127.0.0.1:3080/', bearerToken: 'dev-secret', fetch });

    await expect(client.submitEvents({ chainId, events: [event] })).resolves.toEqual({ appended: 1, chainId, latestSequence: 1 });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3080/chains/019e42ae-9c00-7000-8000-000000000100/events', {
      method: 'POST',
      headers: { 'authorization': 'Bearer dev-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ events: [event] }),
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

  it('reads node metadata and ranged events from a Sphere node', async () => {
    const firstCommand = createEntityCreateCommand({ actorId, entity: entity(), now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000221') });
    const firstEvent = createCommandEvent({ command: firstCommand, chainId, sequence: 1, now, createId: fixedIds('019e42ae-9c00-7000-8000-000000000321') });
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'http://127.0.0.1:3080/health') {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'http://127.0.0.1:3080/node/info') {
        return new Response(JSON.stringify({ name: 'sphere-reference-node', schemaVersion: '0.1.0', storage: 'sqlite' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === `http://127.0.0.1:3080/chains/${chainId}/events?afterSequence=0&limit=1`) {
        return new Response(JSON.stringify({
          chainId,
          events: [firstEvent],
          pageInfo: { afterSequence: 0, limit: 1, returned: 1, nextAfterSequence: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const client = createNodeReadClient({ baseUrl: 'http://127.0.0.1:3080/', bearerToken: 'dev-secret', fetch: fetch as typeof fetch });

    await expect(client.getHealth()).resolves.toEqual({ ok: true });
    await expect(client.getNodeInfo()).resolves.toEqual({
      name: 'sphere-reference-node',
      schemaVersion: '0.1.0',
      storage: 'sqlite',
    });
    await expect(client.getEvents({ chainId, afterSequence: 0, limit: 1 })).resolves.toEqual({
      chainId,
      events: [firstEvent],
      pageInfo: { afterSequence: 0, limit: 1, returned: 1, nextAfterSequence: 1 },
    });
    expect(fetch).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3080/health', { method: 'GET', headers: {} });
    expect(fetch).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3080/node/info', { method: 'GET', headers: {} });
    expect(fetch).toHaveBeenNthCalledWith(3, `http://127.0.0.1:3080/chains/${chainId}/events?afterSequence=0&limit=1`, {
      method: 'GET',
      headers: { authorization: 'Bearer dev-secret' },
    });
  });

  it('reads graph projection queries from a Sphere node', async () => {
    const graphEntity = entity();
    const graphEdge = edge();
    const graphIdentityLink = identityLink();
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === `http://node.local/chains/${chainId}/graph/entities`) {
        return new Response(JSON.stringify({ chainId, entities: [graphEntity] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === `http://node.local/chains/${chainId}/graph/entities/${entityId}`) {
        return new Response(JSON.stringify(graphEntity), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === `http://node.local/chains/${chainId}/graph/edges/from/${encodeURIComponent(actorId)}`) {
        return new Response(JSON.stringify({ chainId, edges: [graphEdge] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === `http://node.local/chains/${chainId}/graph/edges/to/${entityId}`) {
        return new Response(JSON.stringify({ chainId, edges: [graphEdge] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === `http://node.local/chains/${chainId}/graph/identity/${graphIdentityLink.platform}/${graphIdentityLink.platformId}`) {
        return new Response(JSON.stringify(graphIdentityLink), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === `http://node.local/chains/${chainId}/graph/diagnostics`) {
        return new Response(JSON.stringify({ chainId, diagnostics: [{ code: 'unsupported_action', severity: 'info', eventId: 'event-1', action: 'custom:test', message: 'No projection handler for event action custom:test' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const client = createNodeReadClient({ baseUrl: 'http://node.local', fetch: fetch as typeof fetch });

    await expect(client.listEntities({ chainId })).resolves.toEqual({ chainId, entities: [graphEntity] });
    await expect(client.getEntity({ chainId, entityId })).resolves.toEqual(graphEntity);
    await expect(client.getEdgesFrom({ chainId, entityId: actorId })).resolves.toEqual({ chainId, edges: [graphEdge] });
    await expect(client.getEdgesTo({ chainId, entityId })).resolves.toEqual({ chainId, edges: [graphEdge] });
    await expect(client.getIdentityLink({ chainId, platform: graphIdentityLink.platform, platformId: graphIdentityLink.platformId })).resolves.toEqual(graphIdentityLink);
    await expect(client.getDiagnostics({ chainId })).resolves.toEqual({
      chainId,
      diagnostics: [
        {
          code: 'unsupported_action',
          severity: 'info',
          eventId: 'event-1',
          action: 'custom:test',
          message: 'No projection handler for event action custom:test',
        },
      ],
    });
  });

  it('surfaces non-2xx read errors with response details', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'entity_not_found', id: entityId }), { status: 404, headers: { 'content-type': 'application/json' } }));
    const client = createNodeReadClient({ baseUrl: 'http://node.local/', fetch });

    await expect(client.getEntity({ chainId, entityId })).rejects.toMatchObject({
      name: 'CommandSubmissionError',
      status: 404,
      details: { error: 'entity_not_found', id: entityId },
    });
  });
});
