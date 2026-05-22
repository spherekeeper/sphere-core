import { createHash } from 'node:crypto';

import type { Event, JsonValue } from '@sphere/types';

export type CanonicalSerializable = JsonValue;

export interface CanonicalJsonOptions {
  /**
   * Optional object keys to omit at every object level before serialization.
   * This is primarily intended for later event hashing, where `hash` must be excluded.
   */
  omitKeys?: readonly string[];
}

export interface CanonicalXmlOptions extends CanonicalJsonOptions {
  /** Root element name for XML serialization. Defaults to `value`. */
  rootName?: string;
}

export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
  return JSON.stringify(toCanonicalValue(value, new Set(options.omitKeys ?? [])));
}

export function canonicalXml(value: unknown, options: CanonicalXmlOptions = {}): string {
  const rootName = options.rootName ?? 'value';
  assertXmlName(rootName);
  const canonical = toCanonicalValue(value, new Set(options.omitKeys ?? []));
  return serializeXmlElement(rootName, canonical);
}

export function eventToCanonicalJson(event: Event | Record<string, unknown>, options: CanonicalJsonOptions = {}): string {
  return canonicalJson(event, options);
}

export function eventToCanonicalXml(event: Event | Record<string, unknown>, options: CanonicalXmlOptions = {}): string {
  return canonicalXml(event, { rootName: 'event', ...options });
}

export function eventHashPayloadJson(event: Event | Record<string, unknown>): string {
  const { hash: _hash, ...eventWithoutHash } = event;
  return canonicalJson(eventWithoutHash);
}

export function computeEventHash(event: Event | Record<string, unknown>): string {
  return createHash('sha256').update(eventHashPayloadJson(event), 'utf8').digest('hex');
}

export function withEventHash<T extends Event | Record<string, unknown>>(event: T): T & { hash: string } {
  return {
    ...event,
    hash: computeEventHash(event),
  };
}

export function verifyEventHash(event: Event | Record<string, unknown>): boolean {
  return typeof event.hash === 'string' && event.hash === computeEventHash(event);
}

export type EventChainErrorCode =
  | 'empty_chain'
  | 'genesis_previous_hash'
  | 'event_hash_mismatch'
  | 'previous_hash_mismatch'
  | 'sequence_mismatch'
  | 'chain_id_mismatch';

export type EventChainVerificationResult =
  | { ok: true; events: number }
  | { ok: false; index: number; code: EventChainErrorCode; message: string };

export function linkEvent<T extends Event | Record<string, unknown>>(
  previousEvent: Event | Record<string, unknown>,
  nextEvent: T,
): Omit<T, 'previousHash' | 'hash'> & { previousHash: string; hash: string } {
  if (typeof previousEvent.hash !== 'string') {
    throw new TypeError('previousEvent.hash must be a string');
  }

  const linked = {
    ...nextEvent,
    previousHash: previousEvent.hash,
  };

  return withEventHash(linked) as Omit<T, 'previousHash' | 'hash'> & { previousHash: string; hash: string };
}

export function verifyEventChain(events: readonly (Event | Record<string, unknown>)[]): EventChainVerificationResult {
  if (events.length === 0) {
    return { ok: false, index: -1, code: 'empty_chain', message: 'Event chain is empty' };
  }

  const [genesis] = events;
  if (genesis?.previousHash !== null) {
    return {
      ok: false,
      index: 0,
      code: 'genesis_previous_hash',
      message: 'Genesis event previousHash must be null',
    };
  }

  for (let index = 0; index < events.length; index += 1) {
    const current = events[index]!;

    if (!verifyEventHash(current)) {
      return {
        ok: false,
        index,
        code: 'event_hash_mismatch',
        message: `Event at index ${index} has an invalid hash`,
      };
    }

    if (index === 0) {
      continue;
    }

    const previous = events[index - 1]!;

    if (current.chainId !== previous.chainId) {
      return {
        ok: false,
        index,
        code: 'chain_id_mismatch',
        message: `Event at index ${index} has a different chainId`,
      };
    }

    if (typeof current.sequence !== 'number' || current.sequence !== (previous.sequence as number) + 1) {
      return {
        ok: false,
        index,
        code: 'sequence_mismatch',
        message: `Event at index ${index} sequence does not follow previous event`,
      };
    }

    if (current.previousHash !== previous.hash) {
      return {
        ok: false,
        index,
        code: 'previous_hash_mismatch',
        message: `Event at index ${index} previousHash does not match previous event hash`,
      };
    }
  }

  return { ok: true, events: events.length };
}

function toCanonicalValue(value: unknown, omitKeys: ReadonlySet<string>): JsonValue {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;

  if (valueType === 'string' || valueType === 'boolean') {
    return value as string | boolean;
  }

  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Cannot canonically serialize non-finite numbers');
    }
    return value as number;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toCanonicalValue(item, omitKeys));
  }

  if (valueType === 'object') {
    if (value instanceof Date) {
      return value.toISOString();
    }

    const object = value as Record<string, unknown>;
    const canonicalObject: Record<string, JsonValue> = {};

    for (const key of Object.keys(object).sort()) {
      if (omitKeys.has(key)) {
        continue;
      }
      const child = object[key];
      if (child === undefined) {
        throw new TypeError(`Cannot canonically serialize undefined object property: ${key}`);
      }
      canonicalObject[key] = toCanonicalValue(child, omitKeys);
    }

    return canonicalObject;
  }

  throw new TypeError(`Cannot canonically serialize value of type ${valueType}`);
}

function serializeXmlElement(name: string, value: JsonValue): string {
  assertXmlName(name);

  if (value === null) {
    return `<${name} null="true"/>`;
  }

  if (Array.isArray(value)) {
    return `<${name}>${value.map((item) => serializeXmlElement('item', item)).join('')}</${name}>`;
  }

  const valueType = typeof value;

  if (valueType === 'object') {
    const entries = Object.entries(value as Record<string, JsonValue>);
    return `<${name}>${entries.map(([key, child]) => serializeXmlElement(key, child)).join('')}</${name}>`;
  }

  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

function assertXmlName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9._-]*$/.test(name)) {
    throw new TypeError(`Invalid XML element name: ${name}`);
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
