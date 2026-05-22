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
