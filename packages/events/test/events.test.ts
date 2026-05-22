import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  canonicalXml,
  eventToCanonicalJson,
  eventToCanonicalXml,
} from '../src/index.js';

const unordered = {
  z: 'last',
  a: 1,
  nested: {
    b: true,
    a: null,
  },
  list: ['x', { y: `<tag>&"'` }],
};

const event = {
  id: '019e42ae-9c00-7000-8000-000000000001',
  chainId: '019e42ae-9c00-7000-8000-000000000099',
  sequence: 1,
  actorId: '019e42ae-9c00-7000-8000-000000000002',
  subjectId: '019e42ae-9c00-7000-8000-000000000003',
  action: 'entity.create',
  resourceType: 'entity',
  resourceId: '019e42ae-9c00-7000-8000-000000000004',
  timestamp: '2026-05-20T00:00:00.000Z',
  payload: {
    entity: {
      kind: 'group',
      name: 'Sphere <Core> & Friends',
    },
  },
  reason: null,
  schemaVersion: '0.1.0',
  hashAlgorithm: 'sha256',
  previousHash: null,
  hash: 'placeholder-hash',
};

describe('@sphere/events canonical serialization', () => {
  it('serializes JSON deterministically with sorted object keys', () => {
    const expectedJson = readFileSync('specs/test-vectors/valid/canonical-json-basic.txt', 'utf8').trimEnd();

    expect(canonicalJson(unordered)).toBe(expectedJson);
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it('serializes XML deterministically with sorted object keys and escaped text', () => {
    const expectedXml = readFileSync('specs/test-vectors/valid/canonical-xml-basic.xml', 'utf8').trimEnd();

    expect(canonicalXml(unordered)).toBe(expectedXml);
    expect(canonicalXml({ b: 2, a: 1 })).toBe(canonicalXml({ a: 1, b: 2 }));
  });

  it('serializes events to canonical JSON and XML without mutating them', () => {
    const before = structuredClone(event);
    const json = eventToCanonicalJson(event);
    const xml = eventToCanonicalXml(event);

    expect(json).toContain('"action":"entity.create"');
    expect(json.indexOf('"action"')).toBeLessThan(json.indexOf('"actorId"'));
    expect(xml).toContain('<event>');
    expect(xml).toContain('<action>entity.create</action>');
    expect(xml).toContain('<name>Sphere &lt;Core&gt; &amp; Friends</name>');
    expect(event).toEqual(before);
  });

  it('rejects values that cannot be serialized canonically', () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ bad: undefined })).toThrow(TypeError);
    expect(() => canonicalXml({ bad: Symbol('x') })).toThrow(TypeError);
  });
});

