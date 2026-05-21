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

export function parseEvent(value: unknown): Event {
  return parseWith('Event', validators.event, value);
}

export function validateCommand(value: unknown): ValidationResult<Command> {
  return validateWith(validators.command, value);
}

export function parseCommand(value: unknown): Command {
  return parseWith('Command', validators.command, value);
}
