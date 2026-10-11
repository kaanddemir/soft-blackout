import type { PatternCategories } from './settings';
import type { BlackoutAppearance } from '../engine/appearance';

export const PROTOCOL_MARKER = 'soft-blackout';
export const PROTOCOL_VERSION = 1;

export const MODES = ['manual', 'poetry', 'pattern-mask'] as const;
export type Mode = (typeof MODES)[number];
export type RuntimePhase = 'initializing' | 'ready' | 'disposed';

export interface RuntimeSnapshot {
  buildId: string;
  documentId: string;
  phase: RuntimePhase;
  selectedMode: Mode;
  editing: { active: boolean; mode: 'manual' | 'poetry' | null };
  history: { canUndo: boolean; canRedo: boolean; undoCount: number; redoCount: number };
  manual: { maskedCount: number; invalidatedCount: number };
  poetry: { keptCount: number; blockCount: number; editing: boolean; canApply: boolean; canEdit: boolean; compositionCount: number; invalid: boolean };
  pattern: { status: 'idle' | 'scanned' | 'invalid'; counts: { email: number; url: number; phone: number }; total: number; categories: PatternCategories | null };
  pending: boolean;
  styleClaimed: boolean;
  appearance: BlackoutAppearance;
  lastError: SoftBlackoutError | null;
}

export type ErrorCode =
  | 'RESTRICTED_PAGE'
  | 'MISSING_ACTIVE_TAB'
  | 'LOST_PAGE_ACCESS'
  | 'INJECTION_FAILED'
  | 'RUNTIME_UNAVAILABLE'
  | 'RUNTIME_VERSION_MISMATCH'
  | 'RELOAD_REQUIRED'
  | 'INVALID_MESSAGE'
  | 'PAGE_NAVIGATION'
  | 'CLEANUP_FAILED'
  | 'UNSUPPORTED_OPERATION'
  | 'INTERNAL';

export interface SoftBlackoutError {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  actualBuildId?: string;
}

export interface RequestMap {
  PING: { payload: null; data: RuntimeSnapshot };
  GET_STATE: { payload: null; data: RuntimeSnapshot };
  START_EDITING: { payload: { mode: 'manual' }; data: RuntimeSnapshot };
  START_POETRY: { payload: null; data: RuntimeSnapshot };
  APPLY_POETRY: { payload: null; data: RuntimeSnapshot };
  CLEAR_POETRY: { payload: null; data: RuntimeSnapshot };
  DISCARD_POETRY: { payload: null; data: RuntimeSnapshot };
  EDIT_POETRY: { payload: null; data: RuntimeSnapshot };
  CANCEL_POETRY_EDIT: { payload: null; data: RuntimeSnapshot };
  STOP_EDITING: { payload: null; data: RuntimeSnapshot };
  SCAN_PATTERNS: { payload: PatternCategories; data: RuntimeSnapshot };
  APPLY_PATTERNS: { payload: null; data: RuntimeSnapshot };
  CANCEL_PATTERN_SCAN: { payload: null; data: RuntimeSnapshot };
  SET_APPEARANCE: { payload: BlackoutAppearance; data: RuntimeSnapshot };
  UNDO: { payload: null; data: RuntimeSnapshot };
  REDO: { payload: null; data: RuntimeSnapshot };
  RESET: { payload: null; data: RuntimeSnapshot & { changed: number } };
  CLAIM_STYLE: { payload: null; data: RuntimeSnapshot & { claimed: boolean } };
  RELEASE_STYLE: { payload: null; data: RuntimeSnapshot };
  DISPOSE: { payload: null; data: { disposed: true; buildId: string } };
}

export type RequestType = keyof RequestMap;
export type Response<D> = { ok: true; data: D } | { ok: false; error: SoftBlackoutError };

export type Request<T extends RequestType = RequestType> = T extends RequestType ? {
  marker: typeof PROTOCOL_MARKER;
  version: typeof PROTOCOL_VERSION;
  buildId: string;
  requestId: string;
  type: T;
  payload: RequestMap[T]['payload'];
} : never;

const REQUEST_TYPES: readonly RequestType[] = [
  'PING', 'GET_STATE', 'START_EDITING', 'START_POETRY', 'STOP_EDITING', 'APPLY_POETRY',
  'CLEAR_POETRY', 'DISCARD_POETRY', 'EDIT_POETRY', 'CANCEL_POETRY_EDIT',
  'SCAN_PATTERNS', 'APPLY_PATTERNS', 'CANCEL_PATTERN_SCAN', 'SET_APPEARANCE', 'UNDO', 'REDO', 'RESET', 'CLAIM_STYLE', 'RELEASE_STYLE', 'DISPOSE',
];

let requestCounter = 0;

export function makeRequest<T extends RequestType>(buildId: string, type: T, payload: RequestMap[T]['payload']): Request<T> {
  requestCounter += 1;
  return {
    marker: PROTOCOL_MARKER,
    version: PROTOCOL_VERSION,
    buildId,
    requestId: `${Date.now().toString(36)}-${requestCounter}`,
    type,
    payload,
  } as Request<T>;
}

export function makeError(code: ErrorCode, message: string, recoverable = true, actualBuildId?: string): SoftBlackoutError {
  return { code, message, recoverable, ...(actualBuildId ? { actualBuildId } : {}) };
}

export const ok = <D>(data: D): Response<D> => ({ ok: true, data });
export const fail = (error: SoftBlackoutError): Response<never> => ({ ok: false, error });

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPayload(type: RequestType, payload: unknown): boolean {
  switch (type) {
    case 'START_EDITING': return isObject(payload) && payload.mode === 'manual';
    case 'SCAN_PATTERNS': return isObject(payload) && typeof payload.email === 'boolean' && typeof payload.url === 'boolean' && typeof payload.phone === 'boolean';
    case 'SET_APPEARANCE': return isObject(payload) && ['solid', 'marker'].includes(String(payload.style)) && ['#242321', '#f7f4ec', '#a65d51', '#a8977c', '#65786c'].includes(String(payload.color));
    case 'PING':
    case 'GET_STATE':
    case 'STOP_EDITING':
    case 'START_POETRY':
    case 'APPLY_POETRY':
    case 'CLEAR_POETRY':
    case 'DISCARD_POETRY':
    case 'EDIT_POETRY':
    case 'CANCEL_POETRY_EDIT':
    case 'APPLY_PATTERNS':
    case 'CANCEL_PATTERN_SCAN':
    case 'UNDO':
    case 'REDO':
    case 'RESET':
    case 'CLAIM_STYLE':
    case 'RELEASE_STYLE':
    case 'DISPOSE':
      return payload === null;
  }
}

export function isProtocolMessage(value: unknown): value is Record<string, unknown> {
  return isObject(value) && value.marker === PROTOCOL_MARKER;
}

export function validateRequest(value: unknown, runtimeBuildId: string): SoftBlackoutError | null {
  if (!isObject(value) || value.marker !== PROTOCOL_MARKER) return makeError('INVALID_MESSAGE', 'Message is not a Soft Blackout request.', false);
  if (value.version !== PROTOCOL_VERSION) return makeError('INVALID_MESSAGE', 'Unsupported protocol version.', false);
  if (typeof value.type !== 'string' || !(REQUEST_TYPES as readonly string[]).includes(value.type)) {
    return makeError('INVALID_MESSAGE', 'Unknown request type.', false);
  }
  if (typeof value.requestId !== 'string' || value.requestId.length < 1 || value.requestId.length > 128) {
    return makeError('INVALID_MESSAGE', 'Invalid request identifier.', false);
  }
  if (typeof value.buildId !== 'string' || value.buildId.length < 1 || value.buildId.length > 128) {
    return makeError('INVALID_MESSAGE', 'Invalid build identifier.', false);
  }
  const type = value.type as RequestType;
  if (value.buildId !== runtimeBuildId && type !== 'PING' && type !== 'DISPOSE') {
    return makeError('RUNTIME_VERSION_MISMATCH', 'The page is running a different Soft Blackout build.', true, runtimeBuildId);
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'payload') || !validPayload(type, value.payload)) {
    return makeError('INVALID_MESSAGE', `Invalid payload for ${type}.`, false);
  }
  return null;
}

export function isResponse(value: unknown): value is Response<unknown> {
  if (!isObject(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) return Object.prototype.hasOwnProperty.call(value, 'data');
  return isObject(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string' && typeof value.error.recoverable === 'boolean';
}
