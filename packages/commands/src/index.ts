import { linkEvent, withEventHash } from '@sphere/events';
import { createId } from '@sphere/ids';
import type { Command, Edge, Entity, Event, EventWithoutHash, IdentityLink, JsonObject } from '@sphere/types';
import { SPHERE_SCHEMA_VERSION } from '@sphere/types';

export type IdFactory = () => string;

export interface CommandFactoryOptions {
  actorId: string;
  now?: Date;
  createId?: IdFactory;
  reason?: string | null;
}

export interface EntityCreateCommandOptions extends CommandFactoryOptions {
  entity: Entity;
}

export interface EntityUpdateCommandOptions extends CommandFactoryOptions {
  entityId: string;
  patch: JsonObject;
}

export interface IdentityLinkCommandOptions extends CommandFactoryOptions {
  identityLink: IdentityLink;
}

export interface EdgeCreateCommandOptions extends CommandFactoryOptions {
  edge: Edge;
}

export interface CreateCommandEventOptions {
  command: Command;
  chainId: string;
  sequence: number;
  previousEvent?: Event;
  now?: Date;
  createId?: IdFactory;
}

export interface CommandSubmissionClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface SubmitEventsOptions {
  chainId: string;
  events: readonly Event[];
}

export interface SubmitCommandOptions {
  chainId: string;
  command: Command;
}

export interface AppendEventsResponse {
  appended: number;
  chainId: string;
  latestSequence: number | null;
}

export interface SubmitCommandResponse {
  accepted: boolean;
  chainId: string;
  event: Event;
}

export interface CommandSubmissionClient {
  submitEvents(options: SubmitEventsOptions): Promise<AppendEventsResponse>;
  submitCommand(options: SubmitCommandOptions): Promise<SubmitCommandResponse>;
}

export class CommandSubmissionError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, details: unknown) {
    super(`Sphere node command submission failed with status ${status}`);
    this.name = 'CommandSubmissionError';
    this.status = status;
    this.details = details;
  }
}

export function createEntityCreateCommand(options: EntityCreateCommandOptions): Command {
  return createCommand({
    ...options,
    action: 'entity.create',
    resourceType: 'entity',
    resourceId: options.entity.id,
    payload: { entity: options.entity },
  });
}

export function createEntityUpdateCommand(options: EntityUpdateCommandOptions): Command {
  return createCommand({
    ...options,
    action: 'entity.update',
    resourceType: 'entity',
    resourceId: options.entityId,
    payload: { entity: options.patch },
  });
}

export function createIdentityLinkCommand(options: IdentityLinkCommandOptions): Command {
  return createCommand({
    ...options,
    action: 'identity.link',
    resourceType: 'identity_link',
    resourceId: options.identityLink.id,
    payload: { identityLink: options.identityLink },
  });
}

export function createEdgeCreateCommand(options: EdgeCreateCommandOptions): Command {
  return createCommand({
    ...options,
    action: 'edge.create',
    resourceType: 'edge',
    resourceId: options.edge.id,
    payload: { edge: options.edge },
  });
}

export function createCommandEvent(options: CreateCommandEventOptions): Event {
  const eventWithoutHash: EventWithoutHash = {
    id: nextId(options.createId),
    chainId: options.chainId,
    sequence: options.sequence,
    actorId: options.command.actorId,
    subjectId: inferSubjectId(options.command),
    action: options.command.action,
    resourceType: options.command.resourceType,
    resourceId: options.command.resourceId,
    timestamp: timestamp(options.now),
    payload: { ...options.command.payload, command: options.command },
    reason: options.command.reason,
    schemaVersion: SPHERE_SCHEMA_VERSION,
    hashAlgorithm: 'sha256',
    previousHash: options.previousEvent?.hash ?? null,
  };

  if (options.previousEvent === undefined) {
    return withEventHash(eventWithoutHash as unknown as Record<string, unknown>) as unknown as Event;
  }

  return linkEvent(
    options.previousEvent,
    eventWithoutHash as unknown as Record<string, unknown>,
  ) as unknown as Event;
}

export function createCommandSubmissionClient(options: CommandSubmissionClientOptions): CommandSubmissionClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? fetch;

  return {
    async submitEvents(submitOptions: SubmitEventsOptions): Promise<AppendEventsResponse> {
      const response = await fetchImpl(`${baseUrl}/chains/${encodeURIComponent(submitOptions.chainId)}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: submitOptions.events }),
      });
      const details = await parseResponseBody(response);
      if (!response.ok) {
        throw new CommandSubmissionError(response.status, details);
      }
      return details as AppendEventsResponse;
    },
    async submitCommand(submitOptions: SubmitCommandOptions): Promise<SubmitCommandResponse> {
      const response = await fetchImpl(`${baseUrl}/chains/${encodeURIComponent(submitOptions.chainId)}/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: submitOptions.command }),
      });
      const details = await parseResponseBody(response);
      if (!response.ok) {
        throw new CommandSubmissionError(response.status, details);
      }
      return details as SubmitCommandResponse;
    },
  };
}

interface CreateCommandOptions extends CommandFactoryOptions {
  action: Command['action'];
  resourceType: Command['resourceType'];
  resourceId: string | null;
  payload: JsonObject;
}

function createCommand(options: CreateCommandOptions): Command {
  return {
    id: nextId(options.createId),
    actorId: options.actorId,
    action: options.action,
    resourceType: options.resourceType,
    resourceId: options.resourceId,
    payload: options.payload,
    reason: options.reason ?? null,
    createdAt: timestamp(options.now),
    schemaVersion: SPHERE_SCHEMA_VERSION,
  };
}

function inferSubjectId(command: Command): string | null {
  if (command.action === 'identity.link') {
    const identityLink = command.payload.identityLink as Partial<IdentityLink> | undefined;
    return identityLink?.entityId ?? command.resourceId;
  }

  if (command.action === 'edge.create') {
    const edge = command.payload.edge as Partial<Edge> | undefined;
    return edge?.targetId ?? command.resourceId;
  }

  return command.resourceId;
}

function nextId(idFactory: IdFactory | undefined): string {
  return idFactory === undefined ? createId() : idFactory();
}

function timestamp(now: Date | undefined): string {
  return (now ?? new Date()).toISOString();
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
