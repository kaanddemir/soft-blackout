import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_MARKER,
  PROTOCOL_VERSION,
  makeRequest,
  validateRequest,
} from '../../src/shared/protocol';

const BUILD = '1.1.1';

describe('runtime protocol', () => {
  it('creates versioned requests with bounded unique identifiers', () => {
    const first = makeRequest(BUILD, 'PING', null);
    const second = makeRequest(BUILD, 'PING', null);
    expect(first).toMatchObject({ marker: PROTOCOL_MARKER, version: PROTOCOL_VERSION, buildId: BUILD, type: 'PING', payload: null });
    expect(first.requestId).not.toBe(second.requestId);
    expect(validateRequest(first, BUILD)).toBeNull();
  });

  it('allows mismatched builds only to discover or dispose a stale runtime', () => {
    expect(validateRequest(makeRequest('old', 'PING', null), BUILD)).toBeNull();
    expect(validateRequest(makeRequest('old', 'DISPOSE', null), BUILD)).toBeNull();
    expect(validateRequest(makeRequest('old', 'RESET', null), BUILD)?.code).toBe('RUNTIME_VERSION_MISMATCH');
  });

  it.each([
    null,
    {},
    { marker: PROTOCOL_MARKER, version: 99, buildId: BUILD, requestId: 'x', type: 'PING', payload: null },
    { marker: PROTOCOL_MARKER, version: PROTOCOL_VERSION, buildId: BUILD, requestId: '', type: 'PING', payload: null },
    { marker: PROTOCOL_MARKER, version: PROTOCOL_VERSION, buildId: BUILD, requestId: 'x', type: 'UNKNOWN', payload: null },
    { marker: PROTOCOL_MARKER, version: PROTOCOL_VERSION, buildId: BUILD, requestId: 'x', type: 'START_EDITING', payload: { mode: 'poetry' } },
  ])('rejects malformed request %# without mutating state', (request) => {
    expect(validateRequest(request, BUILD)?.code).toBe('INVALID_MESSAGE');
  });

  it('validates Pattern category payloads and rejects retired legacy commands', () => {
    const valid = makeRequest(BUILD, 'SCAN_PATTERNS', { email: true, url: true, phone: false });
    expect(validateRequest(valid, BUILD)).toBeNull();
    expect(validateRequest({ ...valid, payload: { ...valid.payload, phone: 'yes' } }, BUILD)?.code).toBe('INVALID_MESSAGE');
    expect(validateRequest({ marker: PROTOCOL_MARKER, version: PROTOCOL_VERSION, buildId: BUILD, requestId: 'legacy', type: 'AUTO_REDACT', payload: null }, BUILD)?.code).toBe('INVALID_MESSAGE');
  });
});
