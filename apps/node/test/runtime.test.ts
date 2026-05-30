import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  createCommandSubmissionClient,
  createEdgeCreateCommand,
  createEntityCreateCommand,
  createIdentityLinkCommand,
} from '@sphere/commands';

import {
  createNodeRuntime,
  createNodeRuntimeConfig,
  registerNodeRuntimeShutdown,
} from '../src/runtime.js';

class FakeProcess extends EventEmitter {
  exitCode: number | undefined;

  exit(code?: number): never {
    this.exitCode = code;
    return undefined as never;
  }
}

describe('Sphere node runtime', () => {
  it('builds default memory config from environment', () => {
    expect(createNodeRuntimeConfig({})).toEqual({
      host: '0.0.0.0',
      port: 3080,
      storage: { kind: 'memory' },
    });
  });

  it('builds SQLite and bearer-token config from environment and validates port', () => {
    const config = createNodeRuntimeConfig({
      SPHERE_NODE_DB: './sphere-events.sqlite',
      SPHERE_NODE_HOST: '127.0.0.1',
      SPHERE_NODE_PORT: '4090',
      SPHERE_NODE_BEARER_TOKEN: 'dev-secret',
    });

    expect(config).toEqual({
      host: '127.0.0.1',
      port: 4090,
      storage: { kind: 'sqlite', databasePath: './sphere-events.sqlite' },
      bearerToken: 'dev-secret',
    });
    expect(() => createNodeRuntimeConfig({ SPHERE_NODE_PORT: 'not-a-number' })).toThrow(/Invalid SPHERE_NODE_PORT/);
  });

  it('starts and stops a runtime with SQLite storage', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sphere-node-runtime-'));
    const databasePath = join(tempDir, 'events.sqlite');

    try {
      const runtime = createNodeRuntime({
        config: createNodeRuntimeConfig({ SPHERE_NODE_DB: databasePath, SPHERE_NODE_HOST: '127.0.0.1', SPHERE_NODE_PORT: '0' }),
        logger: { info: vi.fn(), error: vi.fn() },
      });

      const address = await runtime.start();
      expect(address).toMatch(/^http:\/\/127\.0\.0\.1:/);

      const response = await fetch(`${address}/node/info`);
      await expect(response.json()).resolves.toMatchObject({ storage: 'sqlite' });

      await runtime.stop();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('submits commands through the client against a running SQLite node', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sphere-node-command-client-'));
    const databasePath = join(tempDir, 'events.sqlite');
    const runtime = createNodeRuntime({
      config: createNodeRuntimeConfig({ SPHERE_NODE_DB: databasePath, SPHERE_NODE_HOST: '127.0.0.1', SPHERE_NODE_PORT: '0' }),
      logger: { info: vi.fn(), error: vi.fn() },
    });

    try {
      const address = await runtime.start();
      const chainId = '019e42ae-9c00-7000-8000-000000000500';
      const actorId = '019e42ae-9c00-7000-8000-000000000502';
      const entityId = '019e42ae-9c00-7000-8000-000000000503';
      const command = createEntityCreateCommand({
        actorId,
        now: new Date('2026-05-29T00:00:00.000Z'),
        createId: () => '019e42ae-9c00-7000-8000-000000000504',
        entity: {
          id: entityId,
          kind: 'group',
          name: 'Runtime Client Smoke Test',
          metadata: { source: 'client' },
          createdAt: '2026-05-29T00:00:00.000Z',
          updatedAt: '2026-05-29T00:00:00.000Z',
          schemaVersion: '0.1.0',
        },
      });
      const client = createCommandSubmissionClient({ baseUrl: address });

      const result = await client.submitCommand({ chainId, command });

      expect(result).toMatchObject({
        accepted: true,
        chainId,
        event: {
          chainId,
          sequence: 1,
          previousHash: null,
          action: 'entity.create',
          payload: { command },
        },
      });

      expect(result.event.hash).toEqual(expect.any(String));
      expect(result.event.hash.length).toBeGreaterThan(0);

      const eventsResponse = await fetch(`${address}/chains/${chainId}/events`);
      expect(eventsResponse.ok).toBe(true);
      await expect(eventsResponse.json()).resolves.toMatchObject({
        chainId,
        events: [{ hash: result.event.hash }],
      });
    } finally {
      await runtime.stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists SQLite-backed command events across runtime restarts', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sphere-node-sqlite-restart-'));
    const databasePath = join(tempDir, 'events.sqlite');
    const config = createNodeRuntimeConfig({
      SPHERE_NODE_DB: databasePath,
      SPHERE_NODE_HOST: '127.0.0.1',
      SPHERE_NODE_PORT: '0',
    });
    const chainId = '019e42ae-9c00-7000-8000-000000000600';
    const actorId = '019e42ae-9c00-7000-8000-000000000601';
    const firstEntityId = '019e42ae-9c00-7000-8000-000000000602';
    const secondEntityId = '019e42ae-9c00-7000-8000-000000000603';
    const logger = { info: vi.fn(), error: vi.fn() };
    const firstCommand = createEntityCreateCommand({
      actorId,
      now: new Date('2026-05-29T00:00:00.000Z'),
      createId: () => '019e42ae-9c00-7000-8000-000000000604',
      entity: {
        id: firstEntityId,
        kind: 'group',
        name: 'Persisted First Entity',
        metadata: { source: 'before-restart' },
        createdAt: '2026-05-29T00:00:00.000Z',
        updatedAt: '2026-05-29T00:00:00.000Z',
        schemaVersion: '0.1.0',
      },
    });
    const secondCommand = createEntityCreateCommand({
      actorId,
      now: new Date('2026-05-29T00:01:00.000Z'),
      createId: () => '019e42ae-9c00-7000-8000-000000000605',
      entity: {
        id: secondEntityId,
        kind: 'group',
        name: 'Persisted Second Entity',
        metadata: { source: 'after-restart' },
        createdAt: '2026-05-29T00:01:00.000Z',
        updatedAt: '2026-05-29T00:01:00.000Z',
        schemaVersion: '0.1.0',
      },
    });

    try {
      const firstRuntime = createNodeRuntime({ config, logger });
      let firstResult: Awaited<ReturnType<ReturnType<typeof createCommandSubmissionClient>['submitCommand']>>;
      try {
        const firstAddress = await firstRuntime.start();
        const firstClient = createCommandSubmissionClient({ baseUrl: firstAddress });
        firstResult = await firstClient.submitCommand({ chainId, command: firstCommand });
        expect(firstResult).toMatchObject({ accepted: true, chainId, event: { sequence: 1, previousHash: null } });
      } finally {
        await firstRuntime.stop();
      }

      const secondRuntime = createNodeRuntime({ config, logger });
      try {
        const secondAddress = await secondRuntime.start();
        const secondClient = createCommandSubmissionClient({ baseUrl: secondAddress });
        const persistedEventsResponse = await fetch(`${secondAddress}/chains/${chainId}/events`);
        const rangedEventsResponse = await fetch(`${secondAddress}/chains/${chainId}/events?afterSequence=0&limit=1`);
        const persistedEntityResponse = await fetch(`${secondAddress}/chains/${chainId}/graph/entities/${firstEntityId}`);
        const secondResult = await secondClient.submitCommand({ chainId, command: secondCommand });
        const allEventsResponse = await fetch(`${secondAddress}/chains/${chainId}/events`);

        expect(persistedEventsResponse.ok).toBe(true);
        await expect(persistedEventsResponse.json()).resolves.toMatchObject({
          chainId,
          events: [{ sequence: 1, hash: firstResult.event.hash }],
        });

        expect(rangedEventsResponse.ok).toBe(true);
        await expect(rangedEventsResponse.json()).resolves.toMatchObject({
          chainId,
          events: [{ sequence: 1, hash: firstResult.event.hash }],
          pageInfo: {
            afterSequence: 0,
            limit: 1,
            returned: 1,
            nextAfterSequence: 1,
          },
        });

        expect(persistedEntityResponse.ok).toBe(true);
        await expect(persistedEntityResponse.json()).resolves.toMatchObject({
          id: firstEntityId,
          name: 'Persisted First Entity',
          metadata: { source: 'before-restart' },
        });

        expect(secondResult).toMatchObject({
          accepted: true,
          chainId,
          event: {
            sequence: 2,
            previousHash: firstResult.event.hash,
            action: 'entity.create',
            payload: { command: secondCommand },
          },
        });

        expect(allEventsResponse.ok).toBe(true);
        await expect(allEventsResponse.json()).resolves.toMatchObject({
          chainId,
          events: [
            { sequence: 1, hash: firstResult.event.hash },
            { sequence: 2, hash: secondResult.event.hash },
          ],
        });
      } finally {
        await secondRuntime.stop();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('replays SQLite-backed graph relationships and identity links after multiple runtime restarts', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sphere-node-sqlite-graph-restart-'));
    const databasePath = join(tempDir, 'events.sqlite');
    const config = createNodeRuntimeConfig({
      SPHERE_NODE_DB: databasePath,
      SPHERE_NODE_HOST: '127.0.0.1',
      SPHERE_NODE_PORT: '0',
    });
    const chainId = '019e42ae-9c00-7000-8000-000000000700';
    const actorId = '019e42ae-9c00-7000-8000-000000000701';
    const personEntityId = '019e42ae-9c00-7000-8000-000000000702';
    const groupEntityId = '019e42ae-9c00-7000-8000-000000000703';
    const edgeId = '019e42ae-9c00-7000-8000-000000000704';
    const identityLinkId = '019e42ae-9c00-7000-8000-000000000705';
    const logger = { info: vi.fn(), error: vi.fn() };
    const startedAt = new Date('2026-05-29T00:00:00.000Z');
    const personCreateCommand = createEntityCreateCommand({
      actorId,
      now: startedAt,
      createId: () => '019e42ae-9c00-7000-8000-000000000706',
      entity: {
        id: personEntityId,
        kind: 'person',
        name: 'Restarted Ada',
        metadata: { role: 'organizer' },
        createdAt: '2026-05-29T00:00:00.000Z',
        updatedAt: '2026-05-29T00:00:00.000Z',
        schemaVersion: '0.1.0',
      },
    });
    const groupCreateCommand = createEntityCreateCommand({
      actorId,
      now: startedAt,
      createId: () => '019e42ae-9c00-7000-8000-000000000707',
      entity: {
        id: groupEntityId,
        kind: 'group',
        name: 'Restarted Bass Collective',
        metadata: { city: 'Berlin' },
        createdAt: '2026-05-29T00:00:00.000Z',
        updatedAt: '2026-05-29T00:00:00.000Z',
        schemaVersion: '0.1.0',
      },
    });
    const edgeCreateCommand = createEdgeCreateCommand({
      actorId,
      now: new Date('2026-05-29T00:01:00.000Z'),
      createId: () => '019e42ae-9c00-7000-8000-000000000708',
      edge: {
        id: edgeId,
        sourceId: personEntityId,
        targetId: groupEntityId,
        type: 'member_of',
        metadata: { confidence: 0.9 },
        createdAt: '2026-05-29T00:01:00.000Z',
        createdBy: actorId,
        schemaVersion: '0.1.0',
      },
    });
    const identityLinkCommand = createIdentityLinkCommand({
      actorId,
      now: new Date('2026-05-29T00:02:00.000Z'),
      createId: () => '019e42ae-9c00-7000-8000-000000000709',
      identityLink: {
        id: identityLinkId,
        entityId: personEntityId,
        platform: 'telegram',
        platformId: 'ada-restarted',
        handle: '@ada_restarted',
        verified: true,
        metadata: { importedFrom: 'restart-smoke' },
        createdAt: '2026-05-29T00:02:00.000Z',
        updatedAt: '2026-05-29T00:02:00.000Z',
        schemaVersion: '0.1.0',
      },
    });

    try {
      const firstRuntime = createNodeRuntime({ config, logger });
      try {
        const firstAddress = await firstRuntime.start();
        const firstClient = createCommandSubmissionClient({ baseUrl: firstAddress });
        const personResult = await firstClient.submitCommand({ chainId, command: personCreateCommand });
        const groupResult = await firstClient.submitCommand({ chainId, command: groupCreateCommand });

        expect(personResult).toMatchObject({ accepted: true, chainId, event: { sequence: 1, action: 'entity.create' } });
        expect(groupResult).toMatchObject({ accepted: true, chainId, event: { sequence: 2, action: 'entity.create' } });
        expect(groupResult.event.previousHash).toBe(personResult.event.hash);
      } finally {
        await firstRuntime.stop();
      }

      const secondRuntime = createNodeRuntime({ config, logger });
      try {
        const secondAddress = await secondRuntime.start();
        const secondClient = createCommandSubmissionClient({ baseUrl: secondAddress });
        const edgeResult = await secondClient.submitCommand({ chainId, command: edgeCreateCommand });
        const identityResult = await secondClient.submitCommand({ chainId, command: identityLinkCommand });

        expect(edgeResult).toMatchObject({ accepted: true, chainId, event: { sequence: 3, action: 'edge.create' } });
        expect(identityResult).toMatchObject({ accepted: true, chainId, event: { sequence: 4, action: 'identity.link' } });
        expect(identityResult.event.previousHash).toBe(edgeResult.event.hash);
      } finally {
        await secondRuntime.stop();
      }

      const thirdRuntime = createNodeRuntime({ config, logger });
      try {
        const thirdAddress = await thirdRuntime.start();
        const eventsResponse = await fetch(`${thirdAddress}/chains/${chainId}/events?afterSequence=2&limit=2`);
        const edgesResponse = await fetch(`${thirdAddress}/chains/${chainId}/graph/edges/from/${personEntityId}`);
        const reverseEdgesResponse = await fetch(`${thirdAddress}/chains/${chainId}/graph/edges/to/${groupEntityId}`);
        const identityResponse = await fetch(`${thirdAddress}/chains/${chainId}/graph/identity/telegram/ada-restarted`);
        const diagnosticsResponse = await fetch(`${thirdAddress}/chains/${chainId}/graph/diagnostics`);

        expect(eventsResponse.ok).toBe(true);
        await expect(eventsResponse.json()).resolves.toMatchObject({
          chainId,
          events: [
            { sequence: 3, action: 'edge.create' },
            { sequence: 4, action: 'identity.link' },
          ],
          pageInfo: {
            afterSequence: 2,
            limit: 2,
            returned: 2,
            nextAfterSequence: 4,
          },
        });

        expect(edgesResponse.ok).toBe(true);
        await expect(edgesResponse.json()).resolves.toMatchObject({
          chainId,
          edges: [
            {
              id: edgeId,
              sourceId: personEntityId,
              targetId: groupEntityId,
              type: 'member_of',
              metadata: { confidence: 0.9 },
            },
          ],
        });

        expect(reverseEdgesResponse.ok).toBe(true);
        await expect(reverseEdgesResponse.json()).resolves.toMatchObject({
          chainId,
          edges: [
            {
              id: edgeId,
              sourceId: personEntityId,
              targetId: groupEntityId,
              type: 'member_of',
              metadata: { confidence: 0.9 },
            },
          ],
        });

        expect(identityResponse.ok).toBe(true);
        await expect(identityResponse.json()).resolves.toMatchObject({
          id: identityLinkId,
          entityId: personEntityId,
          platform: 'telegram',
          platformId: 'ada-restarted',
          handle: '@ada_restarted',
          verified: true,
        });

        expect(diagnosticsResponse.ok).toBe(true);
        await expect(diagnosticsResponse.json()).resolves.toEqual({ chainId, diagnostics: [] });
      } finally {
        await thirdRuntime.stop();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('registers SIGINT/SIGTERM shutdown handlers that stop the runtime', async () => {
    const process = new FakeProcess();
    const runtime = { stop: vi.fn(async () => undefined) };
    const logger = { info: vi.fn(), error: vi.fn() };

    registerNodeRuntimeShutdown({ process, runtime, logger });
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(process.exitCode).toBe(0));

    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith('Received SIGTERM, shutting down Sphere reference node');
  });
});
