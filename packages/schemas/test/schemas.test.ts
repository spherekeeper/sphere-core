import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';
import {
  parseCommand,
  parseEdge,
  parseEntity,
  parseEvent,
  parseIdentityLink,
  validateCommand,
  validateEdge,
  validateEntity,
  validateEvent,
  validateEventActionPayload,
  validateIdentityLink,
} from '../src/index.js';

const requireJson = createRequire(import.meta.url);

const commandSchema = requireJson('../../../specs/schemas/command.schema.json');
const edgeSchema = requireJson('../../../specs/schemas/edge.schema.json');
const entitySchema = requireJson('../../../specs/schemas/entity.schema.json');
const eventSchema = requireJson('../../../specs/schemas/event.schema.json');
const identityLinkSchema = requireJson('../../../specs/schemas/identity-link.schema.json');

const memberOfEdge = requireJson('../../../specs/examples/edges/member-of.json');
const trustsEdge = requireJson('../../../specs/examples/edges/trusts.json');
const circleGroup = requireJson('../../../specs/examples/entities/circle-group.json');
const personEntity = requireJson('../../../specs/examples/entities/person.json');
const edgeCreateEvent = requireJson('../../../specs/examples/events/edge-create.json');
const entityCreateEvent = requireJson('../../../specs/examples/events/entity-create.json');
const discordIdentity = requireJson('../../../specs/examples/identity-links/discord.json');
const walletIdentity = requireJson('../../../specs/examples/identity-links/wallet.json');

const invalidEntityKind = requireJson('../../../specs/test-vectors/invalid/entity-invalid-kind.json');
const invalidIdentityPlatformId = requireJson('../../../specs/test-vectors/invalid/identity-link-empty-platform-id.json');
const invalidEdgeLegacyType = requireJson('../../../specs/test-vectors/invalid/edge-legacy-type.json');
const invalidEventZeroSequence = requireJson('../../../specs/test-vectors/invalid/event-zero-sequence.json');
const invalidCommandMissingFields = requireJson('../../../specs/test-vectors/invalid/command-missing-required-fields.json');

describe('@sphere/schemas', () => {
  it('exports draft JSON schemas', () => {
    expect(entitySchema.title).toBe('Sphere Entity');
    expect(identityLinkSchema.title).toBe('Sphere Identity Link');
    expect(edgeSchema.title).toBe('Sphere Edge');
    expect(eventSchema.title).toBe('Sphere Event');
    expect(commandSchema.title).toBe('Sphere Command');
  });

  it('validates all current example fixtures', () => {
    expect(validateEntity(personEntity).ok).toBe(true);
    expect(validateEntity(circleGroup).ok).toBe(true);
    expect(validateIdentityLink(discordIdentity).ok).toBe(true);
    expect(validateIdentityLink(walletIdentity).ok).toBe(true);
    expect(validateEdge(trustsEdge).ok).toBe(true);
    expect(validateEdge(memberOfEdge).ok).toBe(true);
    expect(validateEvent(entityCreateEvent).ok).toBe(true);
    expect(validateEvent(edgeCreateEvent).ok).toBe(true);
  });

  it('parses valid fixtures as typed values', () => {
    expect(parseEntity(personEntity).kind).toBe('person');
    expect(parseIdentityLink(discordIdentity).platform).toBe('discord');
    expect(parseEdge(trustsEdge).type).toBe('trusts');
    expect(parseEvent(entityCreateEvent).action).toBe('entity.create');
    expect(parseCommand({
      id: '018f0000-0000-7000-8000-000000000050',
      actorId: personEntity.id,
      action: 'entity.create',
      resourceType: 'entity',
      resourceId: personEntity.id,
      payload: { entity: personEntity },
      reason: null,
      createdAt: '2026-05-20T00:00:00.000Z',
      schemaVersion: '0.1.0',
    }).action).toBe('entity.create');
  });

  it('rejects invalid objects with useful errors', () => {
    const result = validateEntity(invalidEntityKind);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const failure = result as Extract<typeof result, { ok: false }>;
      expect(failure.errors.join('\n')).toContain('/kind');
    }

    expect(validateIdentityLink(invalidIdentityPlatformId).ok).toBe(false);
    expect(validateEdge(invalidEdgeLegacyType).ok).toBe(false);
    expect(validateEvent(invalidEventZeroSequence).ok).toBe(false);
    expect(validateCommand(invalidCommandMissingFields).ok).toBe(false);
  });

  it('validates known event action payload contracts', () => {
    expect(validateEventActionPayload(entityCreateEvent).ok).toBe(true);
    expect(validateEventActionPayload(edgeCreateEvent).ok).toBe(true);
    expect(validateEventActionPayload({
      ...entityCreateEvent,
      action: 'identity.link',
      resourceType: 'identity_link',
      payload: { identityLink: discordIdentity },
    }).ok).toBe(true);

    const invalidIdentityLinkEvent = {
      ...entityCreateEvent,
      action: 'identity.link',
      resourceType: 'identity_link',
      payload: { identityLink: { platform: 'discord' } },
    };
    const result = validateEventActionPayload(invalidIdentityLinkEvent);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const failure = result as Extract<typeof result, { ok: false }>;
      expect(failure.errors.join('\n')).toContain('/payload/identityLink');
    }
  });
});
