import { describe, expect, it } from 'vitest';
import {
  compareIds,
  createId,
  isId,
  parseIdTimestamp,
  SPHERE_ID_REGEX,
} from '../src/index.js';

describe('@sphere/ids', () => {
  it('creates UUIDv7-compatible lowercase identifiers', () => {
    const id = createId();

    expect(id).toMatch(SPHERE_ID_REGEX);
    expect(isId(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
    expect(id).toBe(id.toLowerCase());
  });

  it('supports deterministic timestamp and random injection for tests and fixtures', () => {
    const at = new Date('2026-05-20T00:00:00.000Z');
    const id = createId({
      now: at,
      randomBytes: (length) => new Uint8Array(length),
    });

    expect(id).toBe('019e42ae-9c00-7000-8000-000000000000');
    expect(isId(id)).toBe(true);
    expect(parseIdTimestamp(id)?.toISOString()).toBe(at.toISOString());
  });

  it('rejects malformed identifiers', () => {
    expect(isId('')).toBe(false);
    expect(isId('not-a-uuid')).toBe(false);
    expect(isId('018f0000-0000-6000-8000-000000000001')).toBe(false);
    expect(isId('018f0000-0000-7000-c000-000000000001')).toBe(false);
    expect(isId('018F0000-0000-7000-8000-000000000001')).toBe(false);
  });

  it('sorts generated identifiers chronologically for different millisecond timestamps', () => {
    const early = createId({ now: new Date('2026-05-20T00:00:00.000Z') });
    const later = createId({ now: new Date('2026-05-20T00:00:01.000Z') });

    expect(compareIds(early, later)).toBeLessThan(0);
    expect([later, early].sort(compareIds)).toEqual([early, later]);
  });
});
