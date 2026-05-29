import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  createCommandSubmissionClient,
  createEntityCreateCommand,
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

  it('builds SQLite config from SPHERE_NODE_DB and validates port', () => {
    const config = createNodeRuntimeConfig({
      SPHERE_NODE_DB: './sphere-events.sqlite',
      SPHERE_NODE_HOST: '127.0.0.1',
      SPHERE_NODE_PORT: '4090',
    });

    expect(config).toEqual({
      host: '127.0.0.1',
      port: 4090,
      storage: { kind: 'sqlite', databasePath: './sphere-events.sqlite' },
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
