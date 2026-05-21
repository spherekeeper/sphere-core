import { randomBytes } from 'node:crypto';

export const SPHERE_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const MAX_UUIDV7_TIMESTAMP = 0xffffffffffff;

export type SphereId = string;

export interface CreateIdOptions {
  /**
   * Millisecond timestamp source. Defaults to the current wall-clock time.
   * Supplying a Date is intended for tests, fixtures, and deterministic examples.
   */
  now?: Date | number;
  /**
   * Optional random byte source. Must return exactly `length` bytes.
   * This is exposed for deterministic test vectors, not normal production use.
   */
  randomBytes?: (length: number) => Uint8Array;
}

export function createId(options: CreateIdOptions = {}): SphereId {
  const timestampMs = normalizeTimestamp(options.now ?? Date.now());
  const randomSource = options.randomBytes ?? ((length: number) => randomBytes(length));
  const bytes = Uint8Array.from(randomSource(16));

  if (bytes.length !== 16) {
    throw new TypeError(`UUIDv7 random source must return 16 bytes; received ${bytes.length}`);
  }

  writeTimestamp(bytes, timestampMs);

  // UUIDv7 version bits: byte 6 high nibble must be 0b0111.
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;

  // RFC 4122 variant bits: byte 8 high bits must be 0b10.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  return formatUuid(bytes);
}

export function isId(value: unknown): value is SphereId {
  return typeof value === 'string' && SPHERE_ID_REGEX.test(value);
}

export function assertId(value: unknown, label = 'id'): asserts value is SphereId {
  if (!isId(value)) {
    throw new TypeError(`${label} must be a lowercase UUIDv7-compatible Sphere ID`);
  }
}

export function parseIdTimestamp(id: string): Date | null {
  if (!isId(id)) {
    return null;
  }

  const hex = id.replace(/-/g, '').slice(0, 12);
  const timestampMs = Number.parseInt(hex, 16);

  if (!Number.isSafeInteger(timestampMs)) {
    return null;
  }

  return new Date(timestampMs);
}

export function compareIds(left: string, right: string): number {
  assertId(left, 'left');
  assertId(right, 'right');
  return left.localeCompare(right);
}

function normalizeTimestamp(value: Date | number): number {
  const timestampMs = value instanceof Date ? value.getTime() : value;

  if (!Number.isInteger(timestampMs) || timestampMs < 0 || timestampMs > MAX_UUIDV7_TIMESTAMP) {
    throw new RangeError(`UUIDv7 timestamp must be an integer between 0 and ${MAX_UUIDV7_TIMESTAMP}`);
  }

  return timestampMs;
}

function writeTimestamp(bytes: Uint8Array, timestampMs: number): void {
  let remaining = timestampMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 0x100);
  }
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
