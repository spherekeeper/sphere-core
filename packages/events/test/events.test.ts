import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  canonicalXml,
  computeEventHash,
  eventHashPayloadJson,
  eventToCanonicalJson,
  eventToCanonicalXml,
  linkEvent,
  verifyEventChain,
  verifyEventHash,
  withEventHash,
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
    hash: 'payload-hash-must-remain-in-hash-input',
  },
  reason: null,
  schemaVersion: '0.1.0',
  hashAlgorithm: 'sha256',
  previousHash: null,
  hash: 'placeholder-hash',
};

function expectChainErrorCode(events: Parameters<typeof verifyEventChain>[0], code: string): void {
  const result = verifyEventChain(events);
  expect(result.ok).toBe(false);
  if ('code' in result) {
    expect(result.code).toBe(code);
  }
}

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

  it('hashes events deterministically with SHA-256 over canonical JSON excluding only the top-level hash', () => {
    const hashInput = eventHashPayloadJson(event);
    const hash = computeEventHash(event);
    const hashed = withEventHash(event);

    expect(hashInput).not.toContain('"hash":"placeholder-hash"');
    expect(hashInput).toContain('"hash":"payload-hash-must-remain-in-hash-input"');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEventHash({ ...event, hash: 'changed-hash' })).toBe(hash);
    expect(computeEventHash({ ...event, payload: { ...event.payload, hash: 'changed-payload-hash' } })).not.toBe(hash);
    expect(hashed).toEqual({ ...event, hash });
    expect(verifyEventHash(hashed)).toBe(true);
    expect(verifyEventHash({ ...hashed, action: 'edge.create' })).toBe(false);
  });

  it('supports fixture-backed event hashes', () => {
    const expectedHash = readFileSync('specs/test-vectors/valid/event-hash-basic.sha256', 'utf8').trimEnd();
    expect(computeEventHash(event)).toBe(expectedHash);
  });

  it('links and verifies ordered event hash chains', () => {
    const genesis = withEventHash({ ...event, sequence: 1, previousHash: null });
    const secondDraft = {
      ...event,
      id: '019e42ae-9c00-7000-8000-000000000005',
      sequence: 2,
      action: 'edge.create',
      payload: { edge: { type: 'member_of' } },
      previousHash: 'will-be-replaced',
      hash: 'will-be-replaced',
    };
    const second = linkEvent(genesis, secondDraft);

    expect(second.previousHash).toBe(genesis.hash);
    expect(second.hash).toBe(computeEventHash(second));
    expect(verifyEventChain([genesis, second])).toEqual({ ok: true, events: 2 });
  });

  it('rejects broken hash chains with useful error codes', () => {
    const genesis = withEventHash({ ...event, sequence: 1, previousHash: null });
    const second = linkEvent(genesis, {
      ...event,
      id: '019e42ae-9c00-7000-8000-000000000005',
      sequence: 2,
      action: 'edge.create',
    });

    expect(verifyEventChain([])).toEqual({ ok: false, index: -1, code: 'empty_chain', message: 'Event chain is empty' });
    expectChainErrorCode([{ ...genesis, previousHash: second.hash }, second], 'genesis_previous_hash');
    expectChainErrorCode([genesis, { ...second, previousHash: 'bad', hash: computeEventHash({ ...second, previousHash: 'bad' }) }], 'previous_hash_mismatch');
    expectChainErrorCode([genesis, { ...second, sequence: 3, hash: computeEventHash({ ...second, sequence: 3 }) }], 'sequence_mismatch');
    expectChainErrorCode([genesis, { ...second, chainId: '019e42ae-9c00-7000-8000-000000000098', hash: computeEventHash({ ...second, chainId: '019e42ae-9c00-7000-8000-000000000098' }) }], 'chain_id_mismatch');
    expectChainErrorCode([genesis, { ...second, action: 'identity.link' }], 'event_hash_mismatch');
  });

  it('verifies hash-chain fixtures', () => {
    const validChain = JSON.parse(readFileSync('specs/test-vectors/hash-chain/valid-basic-chain.json', 'utf8'));
    const brokenPreviousHash = JSON.parse(readFileSync('specs/test-vectors/hash-chain/invalid-broken-previous-hash.json', 'utf8'));

    expect(verifyEventChain(validChain)).toEqual({ ok: true, events: 2 });
    expectChainErrorCode(brokenPreviousHash, 'previous_hash_mismatch');
  });

  it('rejects values that cannot be serialized canonically', () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ bad: undefined })).toThrow(TypeError);
    expect(() => canonicalXml({ bad: Symbol('x') })).toThrow(TypeError);
  });
});

