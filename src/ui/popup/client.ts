import { BUILD_ID, CONTENT_RUNTIME_FILE, CONTENT_STYLE_FILE, isRestrictedUrl } from '../../shared/constants';
import {
  fail,
  isResponse,
  makeError,
  makeRequest,
  type RequestMap,
  type RequestType,
  type Response,
  type RuntimeSnapshot,
} from '../../shared/protocol';

export type RuntimeProbe =
  | { kind: 'compatible'; state: RuntimeSnapshot }
  | { kind: 'missing' }
  | { kind: 'stale'; buildId: string; disposable: true }
  | { kind: 'legacy'; buildId?: string }
  | { kind: 'unavailable'; error: ReturnType<typeof makeError> };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function activeTab(): Promise<Response<chrome.tabs.Tab>> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return fail(makeError('MISSING_ACTIVE_TAB', 'Cannot access the active tab.', true));
  if (isRestrictedUrl(tab.url)) return fail(makeError('RESTRICTED_PAGE', 'Cannot run on this page.', false));
  return { ok: true, data: tab };
}

export async function request<T extends RequestType>(tabId: number, type: T, payload: RequestMap[T]['payload']): Promise<Response<RequestMap[T]['data']>> {
  try {
    const raw: unknown = await chrome.tabs.sendMessage(tabId, makeRequest(BUILD_ID, type, payload), { frameId: 0 });
    if (!isResponse(raw)) return fail(makeError('RUNTIME_UNAVAILABLE', `Malformed response to ${type}.`, true));
    return raw as Response<RequestMap[T]['data']>;
  } catch (error) {
    return fail(makeError('RUNTIME_UNAVAILABLE', errorMessage(error), true));
  }
}

export async function probeRuntime(tabId: number): Promise<RuntimeProbe> {
  const typed = await request(tabId, 'PING', null);
  if (typed.ok) {
    if (typed.data.buildId === BUILD_ID) return { kind: 'compatible', state: typed.data };
    return { kind: 'stale', buildId: typed.data.buildId, disposable: true };
  }
  try {
    const legacy = await chrome.tabs.sendMessage(tabId, { action: 'ping' }, { frameId: 0 }) as { pong?: unknown; buildId?: unknown } | undefined;
    if (legacy?.pong === true) return { kind: 'legacy', ...(typeof legacy.buildId === 'string' ? { buildId: legacy.buildId } : {}) };
  } catch {
    // Missing runtimes reject both probes.
  }
  return typed.error.code === 'RUNTIME_UNAVAILABLE' ? { kind: 'missing' } : { kind: 'unavailable', error: typed.error };
}

async function removeOwnedStyle(tabId: number): Promise<void> {
  try {
    await chrome.scripting.removeCSS({ target: { tabId }, files: [CONTENT_STYLE_FILE] });
  } catch {
    // Missing stylesheet/document is already clean.
  }
}

export async function disposeRuntime(tabId: number): Promise<Response<{ disposed: true; buildId: string }>> {
  const result = await request(tabId, 'DISPOSE', null);
  if (result.ok) await removeOwnedStyle(tabId);
  return result;
}

export async function ensureRuntime(tab: chrome.tabs.Tab): Promise<Response<{ state: RuntimeSnapshot; injected: boolean }>> {
  if (!tab.id) return fail(makeError('MISSING_ACTIVE_TAB', 'Cannot access the active tab.', true));
  if (isRestrictedUrl(tab.url)) return fail(makeError('RESTRICTED_PAGE', 'Cannot run on this page.', false));

  const probe = await probeRuntime(tab.id);
  if (probe.kind === 'compatible') return { ok: true, data: { state: probe.state, injected: false } };
  if (probe.kind === 'legacy') {
    return fail(makeError('RELOAD_REQUIRED', 'Reload this page to update Soft Blackout.', true, probe.buildId));
  }
  if (probe.kind === 'unavailable') return fail(probe.error);
  if (probe.kind === 'stale') {
    const disposed = await disposeRuntime(tab.id);
    if (!disposed.ok) return fail(makeError('RELOAD_REQUIRED', 'Reload this page to update Soft Blackout.', true, probe.buildId));
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_RUNTIME_FILE] });
  } catch (error) {
    return fail(classifyInjectionError(errorMessage(error)));
  }

  const confirm = await request(tab.id, 'PING', null);
  if (!confirm.ok) return fail(makeError('RUNTIME_UNAVAILABLE', 'The page runtime did not initialize.', true));
  if (confirm.data.buildId !== BUILD_ID) return fail(makeError('RUNTIME_VERSION_MISMATCH', 'The page is running a different Soft Blackout build.', true, confirm.data.buildId));

  const claim = await request(tab.id, 'CLAIM_STYLE', null);
  if (!claim.ok) return claim;
  if (claim.data.claimed) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: [CONTENT_STYLE_FILE] });
    } catch (error) {
      await request(tab.id, 'RELEASE_STYLE', null);
      await request(tab.id, 'DISPOSE', null);
      return fail(classifyInjectionError(errorMessage(error)));
    }
  }
  const state = await request(tab.id, 'GET_STATE', null);
  return state.ok ? { ok: true, data: { state: state.data, injected: true } } : state;
}

export function classifyInjectionError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('cannot be scripted') || lower.includes('chrome://') || lower.includes('extensions gallery')) {
    return makeError('RESTRICTED_PAGE', 'Cannot run on this page.', false);
  }
  if (lower.includes('permission') || lower.includes('cannot access') || lower.includes('host')) {
    return makeError('LOST_PAGE_ACCESS', 'Page access was lost. Reopen the popup and try again.', true);
  }
  return makeError('INJECTION_FAILED', 'Soft Blackout could not start on this page.', true);
}
