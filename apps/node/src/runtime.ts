import type { EventEmitter } from 'node:events';

import type { FastifyInstance } from 'fastify';

import { createInMemoryEventStore, createSqliteEventStore, type CloseableEventStore, type EventStore } from '@sphere/event-store';

import { buildNodeApp } from './index.js';

export interface NodeRuntimeConfig {
  host: string;
  port: number;
  storage: NodeRuntimeStorageConfig;
  bearerToken?: string;
}

export type NodeRuntimeStorageConfig =
  | { kind: 'memory' }
  | { kind: 'sqlite'; databasePath: string };

export interface NodeRuntimeLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface NodeRuntime {
  start(): Promise<string>;
  stop(): Promise<void>;
}

export interface CreateNodeRuntimeOptions {
  config?: NodeRuntimeConfig;
  logger?: NodeRuntimeLogger;
}

export interface ShutdownProcess extends EventEmitter {
  exit(code?: number): never;
}

export interface RegisterNodeRuntimeShutdownOptions {
  process: ShutdownProcess;
  runtime: Pick<NodeRuntime, 'stop'>;
  logger?: NodeRuntimeLogger;
}

const defaultLogger: NodeRuntimeLogger = {
  info(message) {
    console.info(message);
  },
  error(message, error) {
    if (error === undefined) {
      console.error(message);
      return;
    }
    console.error(message, error);
  },
};

export function createNodeRuntimeConfig(env: NodeJS.ProcessEnv = process.env): NodeRuntimeConfig {
  const port = parseNodePort(env.SPHERE_NODE_PORT ?? '3080');
  const host = env.SPHERE_NODE_HOST ?? '0.0.0.0';
  const databasePath = env.SPHERE_NODE_DB;
  const bearerToken = env.SPHERE_NODE_BEARER_TOKEN;

  return {
    host,
    port,
    storage: databasePath === undefined || databasePath.length === 0
      ? { kind: 'memory' }
      : { kind: 'sqlite', databasePath },
    ...(bearerToken === undefined || bearerToken.length === 0 ? {} : { bearerToken }),
  };
}

export function createNodeRuntime(options: CreateNodeRuntimeOptions = {}): NodeRuntime {
  const config = options.config ?? createNodeRuntimeConfig();
  const logger = options.logger ?? defaultLogger;
  const eventStore = createEventStore(config.storage);
  const app = buildNodeApp({
    eventStore,
    ...(config.bearerToken === undefined ? {} : { bearerToken: config.bearerToken }),
  });

  return new FastifyNodeRuntime({ app, eventStore, config, logger });
}

export function registerNodeRuntimeShutdown(options: RegisterNodeRuntimeShutdownOptions): void {
  const logger = options.logger ?? defaultLogger;
  let shuttingDown = false;

  const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void (async () => {
      logger.info(`Received ${signal}, shutting down Sphere reference node`);
      try {
        await options.runtime.stop();
        options.process.exit(0);
      } catch (error) {
        logger.error('Failed to stop Sphere reference node cleanly', error);
        options.process.exit(1);
      }
    })();
  };

  options.process.on('SIGINT', () => shutdown('SIGINT'));
  options.process.on('SIGTERM', () => shutdown('SIGTERM'));
}

export async function runNodeRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<NodeRuntime> {
  const logger = defaultLogger;
  const runtime = createNodeRuntime({ config: createNodeRuntimeConfig(env), logger });
  registerNodeRuntimeShutdown({ process, runtime, logger });
  await runtime.start();
  return runtime;
}

function parseNodePort(rawPort: string): number {
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || String(port) !== rawPort || port < 0 || port > 65_535) {
    throw new Error(`Invalid SPHERE_NODE_PORT: ${rawPort}`);
  }
  return port;
}

function createEventStore(storage: NodeRuntimeStorageConfig): EventStore {
  if (storage.kind === 'sqlite') {
    return createSqliteEventStore({ databasePath: storage.databasePath });
  }
  return createInMemoryEventStore();
}

function isCloseableEventStore(eventStore: EventStore): eventStore is CloseableEventStore {
  return typeof (eventStore as Partial<CloseableEventStore>).close === 'function';
}

class FastifyNodeRuntime implements NodeRuntime {
  readonly #app: FastifyInstance;
  readonly #eventStore: EventStore;
  readonly #config: NodeRuntimeConfig;
  readonly #logger: NodeRuntimeLogger;
  #started = false;

  constructor(options: {
    app: FastifyInstance;
    eventStore: EventStore;
    config: NodeRuntimeConfig;
    logger: NodeRuntimeLogger;
  }) {
    this.#app = options.app;
    this.#eventStore = options.eventStore;
    this.#config = options.config;
    this.#logger = options.logger;
  }

  async start(): Promise<string> {
    if (this.#started) {
      throw new Error('Sphere reference node runtime is already started');
    }
    const address = await this.#app.listen({ host: this.#config.host, port: this.#config.port });
    this.#started = true;
    this.#logger.info(`Sphere reference node listening at ${address}`);
    return address;
  }

  async stop(): Promise<void> {
    if (this.#started) {
      await this.#app.close();
      this.#started = false;
    }
    if (isCloseableEventStore(this.#eventStore)) {
      this.#eventStore.close();
    }
  }
}
