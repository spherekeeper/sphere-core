import { createRequire } from 'node:module';

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';

import type {
  Command,
  Edge,
  Entity,
  Event,
  IdentityLink,
} from '@sphere/types';
export {
  SPHERE_PROTOCOL_VERSION,
  SPHERE_SCHEMA_VERSION,
  SPHERE_SUPPORTED_SCHEMA_VERSIONS,
  isSupportedSchemaVersion,
} from '@sphere/types';

const requireJson = createRequire(import.meta.url);

const commandSchema = requireJson('../../../specs/schemas/command.schema.json') as object;
const edgeSchema = requireJson('../../../specs/schemas/edge.schema.json') as object;
const entitySchema = requireJson('../../../specs/schemas/entity.schema.json') as object;
const eventSchema = requireJson('../../../specs/schemas/event.schema.json') as object;
const identityLinkSchema = requireJson('../../../specs/schemas/identity-link.schema.json') as object;

export {
  commandSchema,
  edgeSchema,
  entitySchema,
  eventSchema,
  identityLinkSchema,
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[]; details: ErrorObject[] };

export class SphereSchemaValidationError extends Error {
  readonly errors: string[];
  readonly details: ErrorObject[];

  constructor(kind: string, errors: string[], details: ErrorObject[]) {
    super(`Invalid Sphere ${kind}: ${errors.join('; ')}`);
    this.name = 'SphereSchemaValidationError';
    this.errors = errors;
    this.details = details;
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
const addFormats = (addFormatsModule.default ?? addFormatsModule) as unknown as (instance: Ajv2020) => void;
addFormats(ajv);

const validators = {
  entity: ajv.compile<Entity>(entitySchema),
  identityLink: ajv.compile<IdentityLink>(identityLinkSchema),
  edge: ajv.compile<Edge>(edgeSchema),
  event: ajv.compile<Event>(eventSchema),
  command: ajv.compile<Command>(commandSchema),
};

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const path = error.instancePath || '/';
    return `${path} ${error.message ?? 'failed validation'}`;
  });
}

function validateWith<T>(validator: ValidateFunction<T>, value: unknown): ValidationResult<T> {
  if (validator(value)) {
    return { ok: true, value: value as T };
  }

  const details = [...(validator.errors ?? [])];
  return {
    ok: false,
    errors: formatErrors(details),
    details,
  };
}

function parseWith<T>(kind: string, validator: ValidateFunction<T>, value: unknown): T {
  const result = validateWith(validator, value);
  if (result.ok) {
    return result.value;
  }

  const failure = result as Extract<ValidationResult<T>, { ok: false }>;
  throw new SphereSchemaValidationError(kind, failure.errors, failure.details);
}

function validatePayloadForEvent(event: Event): string[] {
  switch (event.action) {
    case 'entity.create':
      return validateEntityCreatePayload(event);
    case 'entity.update':
      return validateObjectPayload(event, 'entity');
    case 'entity.delete':
      return validateResourceId(event, 'entity');
    case 'edge.create':
      return validateEdgeCreatePayload(event);
    case 'edge.delete':
      return validateResourceId(event, 'edge');
    case 'identity.link':
      return validateIdentityLinkPayload(event);
    case 'identity.unlink':
      return validateResourceId(event, 'identity_link');
    default:
      return [];
  }
}

function validateEntityCreatePayload(event: Event): string[] {
  const payloadEntity = objectProperty(event.payload, 'entity');
  if (payloadEntity === undefined) {
    return ['/payload/entity must be object'];
  }

  const candidate = {
    id: stringProperty(payloadEntity, 'id') ?? event.resourceId,
    kind: stringProperty(payloadEntity, 'kind') ?? 'resource',
    name: stringProperty(payloadEntity, 'name') ?? event.resourceId,
    metadata: objectProperty(payloadEntity, 'metadata') ?? {},
    createdAt: stringProperty(payloadEntity, 'createdAt') ?? event.timestamp,
    updatedAt: stringProperty(payloadEntity, 'updatedAt') ?? event.timestamp,
    schemaVersion: event.schemaVersion,
  };
  return prefixedErrors('/payload/entity', validateEntity(candidate));
}

function validateEdgeCreatePayload(event: Event): string[] {
  const payloadEdge = objectProperty(event.payload, 'edge');
  if (payloadEdge === undefined) {
    return ['/payload/edge must be object'];
  }

  const candidate = {
    id: stringProperty(payloadEdge, 'id') ?? (event.resourceType === 'edge' ? event.resourceId : event.id),
    sourceId: stringProperty(payloadEdge, 'sourceId') ?? event.subjectId,
    targetId: stringProperty(payloadEdge, 'targetId') ?? event.resourceId,
    type: stringProperty(payloadEdge, 'type') ?? 'custom:unknown',
    metadata: objectProperty(payloadEdge, 'metadata') ?? {},
    createdAt: stringProperty(payloadEdge, 'createdAt') ?? event.timestamp,
    createdBy: stringProperty(payloadEdge, 'createdBy') ?? event.actorId,
    schemaVersion: event.schemaVersion,
    deletedAt: nullableStringProperty(payloadEdge, 'deletedAt'),
    deletedBy: nullableStringProperty(payloadEdge, 'deletedBy'),
  };
  return prefixedErrors('/payload/edge', validateEdge(candidate));
}

function validateIdentityLinkPayload(event: Event): string[] {
  const payloadLink = objectProperty(event.payload, 'identityLink') ?? objectProperty(event.payload, 'identity_link');
  if (payloadLink === undefined) {
    return ['/payload/identityLink must be object'];
  }
  return prefixedErrors('/payload/identityLink', validateIdentityLink(payloadLink));
}

function validateObjectPayload(event: Event, key: string): string[] {
  return objectProperty(event.payload, key) === undefined ? [`/payload/${key} must be object`] : [];
}

function validateResourceId(event: Event, expectedResourceType: Event['resourceType']): string[] {
  const errors: string[] = [];
  if (event.resourceType !== expectedResourceType) {
    errors.push(`/resourceType must be ${expectedResourceType}`);
  }
  if (typeof event.resourceId !== 'string' || event.resourceId.length === 0) {
    errors.push('/resourceId must be non-empty string');
  }
  return errors;
}

function prefixedErrors<T>(prefix: string, result: ValidationResult<T>): string[] {
  if (result.ok) {
    return [];
  }
  const failure = result as Extract<ValidationResult<T>, { ok: false }>;
  return failure.errors.map((error) => `${prefix}${error.startsWith('/') ? error : ` ${error}`}`);
}

function objectProperty(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const property = value[key];
  return property !== null && typeof property === 'object' && !Array.isArray(property)
    ? (property as Record<string, unknown>)
    : undefined;
}

function stringProperty(value: Record<string, unknown>, key: string): string | undefined {
  const property = value[key];
  return typeof property === 'string' ? property : undefined;
}

function nullableStringProperty(value: Record<string, unknown>, key: string): string | null | undefined {
  const property = value[key];
  if (typeof property === 'string' || property === null) {
    return property as string | null;
  }
  return undefined;
}

export function validateEntity(value: unknown): ValidationResult<Entity> {
  return validateWith(validators.entity, value);
}

export function parseEntity(value: unknown): Entity {
  return parseWith('Entity', validators.entity, value);
}

export function validateIdentityLink(value: unknown): ValidationResult<IdentityLink> {
  return validateWith(validators.identityLink, value);
}

export function parseIdentityLink(value: unknown): IdentityLink {
  return parseWith('IdentityLink', validators.identityLink, value);
}

export function validateEdge(value: unknown): ValidationResult<Edge> {
  return validateWith(validators.edge, value);
}

export function parseEdge(value: unknown): Edge {
  return parseWith('Edge', validators.edge, value);
}

export function validateEvent(value: unknown): ValidationResult<Event> {
  return validateWith(validators.event, value);
}

export function validateEventActionPayload(value: unknown): ValidationResult<Event> {
  const envelope = validateEvent(value);
  if (!envelope.ok) {
    return envelope;
  }

  const event = envelope.value;
  const errors = validatePayloadForEvent(event);
  if (errors.length > 0) {
    return { ok: false, errors, details: [] };
  }

  return { ok: true, value: event };
}

export function parseEvent(value: unknown): Event {
  return parseWith('Event', validators.event, value);
}

export function validateCommand(value: unknown): ValidationResult<Command> {
  return validateWith(validators.command, value);
}

export function parseCommand(value: unknown): Command {
  return parseWith('Command', validators.command, value);
}
