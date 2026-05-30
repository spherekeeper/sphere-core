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
  bearerToken?: string;
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

export type CommandPolicyViolationCode =
  | 'resource_type_mismatch'
  | 'resource_id_required'
  | 'resource_id_mismatch'
  | 'missing_payload_object'
  | 'payload_id_required'
  | 'unsupported_action';

export interface CommandPolicyViolation {
  code: CommandPolicyViolationCode;
  path: string;
  message: string;
}

export type CommandPolicyResult =
  | { ok: true }
  | { ok: false; errors: CommandPolicyViolation[] };

export class CommandPolicyError extends Error {
  readonly errors: CommandPolicyViolation[];

  constructor(errors: CommandPolicyViolation[]) {
    super(`Sphere command failed policy validation: ${errors.map((error) => error.message).join('; ')}`);
    this.name = 'CommandPolicyError';
    this.errors = errors;
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
  assertCommandPolicy(options.command);

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

export function validateCommandPolicy(command: Command): CommandPolicyResult {
  const errors: CommandPolicyViolation[] = [];

  switch (command.action) {
    case 'entity.create':
      requireResourceType(command, 'entity', errors);
      requirePayloadResourceId(command, 'entity', errors);
      break;
    case 'entity.update':
      requireResourceType(command, 'entity', errors);
      requireResourceId(command, errors);
      requirePayloadObject(command, 'entity', errors);
      break;
    case 'entity.delete':
      requireResourceType(command, 'entity', errors);
      requireResourceId(command, errors);
      break;
    case 'identity.link':
      requireResourceType(command, 'identity_link', errors);
      requirePayloadResourceId(command, 'identityLink', errors);
      break;
    case 'identity.unlink':
      requireResourceType(command, 'identity_link', errors);
      requireResourceId(command, errors);
      break;
    case 'edge.create':
      requireResourceType(command, 'edge', errors);
      requirePayloadResourceId(command, 'edge', errors);
      break;
    case 'edge.delete':
      requireResourceType(command, 'edge', errors);
      requireResourceId(command, errors);
      break;
    default:
      if (!command.action.startsWith('custom:')) {
        errors.push({
          code: 'unsupported_action',
          path: '/action',
          message: `Unsupported core command action ${command.action}`,
        });
      }
      break;
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function assertCommandPolicy(command: Command): void {
  const result = validateCommandPolicy(command);
  if (!result.ok) {
    throw new CommandPolicyError(result.errors);
  }
}

export function createCommandSubmissionClient(options: CommandSubmissionClientOptions): CommandSubmissionClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? fetch;
  const headers = createJsonHeaders(options.bearerToken);

  return {
    async submitEvents(submitOptions: SubmitEventsOptions): Promise<AppendEventsResponse> {
      const response = await fetchImpl(`${baseUrl}/chains/${encodeURIComponent(submitOptions.chainId)}/events`, {
        method: 'POST',
        headers,
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
        headers,
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

function requireResourceType(command: Command, expected: Command['resourceType'], errors: CommandPolicyViolation[]): void {
  if (command.resourceType !== expected) {
    errors.push({
      code: 'resource_type_mismatch',
      path: '/resourceType',
      message: `${command.action} commands must use resourceType ${expected}`,
    });
  }
}

function requireResourceId(command: Command, errors: CommandPolicyViolation[]): void {
  if (typeof command.resourceId !== 'string' || command.resourceId.length === 0) {
    errors.push({
      code: 'resource_id_required',
      path: '/resourceId',
      message: `${command.action} commands must include a non-empty resourceId`,
    });
  }
}

function requirePayloadResourceId(command: Command, payloadKey: string, errors: CommandPolicyViolation[]): void {
  const payloadObject = requirePayloadObject(command, payloadKey, errors);
  if (payloadObject === undefined) {
    return;
  }

  const payloadId = payloadObject.id;
  if (typeof payloadId !== 'string' || payloadId.length === 0) {
    errors.push({
      code: 'payload_id_required',
      path: `/payload/${payloadKey}/id`,
      message: `${command.action} commands must include payload.${payloadKey}.id`,
    });
    return;
  }

  if (command.resourceId !== payloadId) {
    errors.push({
      code: 'resource_id_mismatch',
      path: '/resourceId',
      message: `${command.action} resourceId must match payload.${payloadKey}.id`,
    });
  }
}

function requirePayloadObject(
  command: Command,
  payloadKey: string,
  errors: CommandPolicyViolation[],
): Record<string, unknown> | undefined {
  const payloadValue = command.payload[payloadKey];
  if (payloadValue === null || typeof payloadValue !== 'object' || Array.isArray(payloadValue)) {
    errors.push({
      code: 'missing_payload_object',
      path: `/payload/${payloadKey}`,
      message: `${command.action} commands must include payload.${payloadKey} object`,
    });
    return undefined;
  }
  return payloadValue as Record<string, unknown>;
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

function createJsonHeaders(bearerToken: string | undefined): Record<string, string> {
  return bearerToken === undefined
    ? { 'content-type': 'application/json' }
    : { 'authorization': `Bearer ${bearerToken}`, 'content-type': 'application/json' };
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
