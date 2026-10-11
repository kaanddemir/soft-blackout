import { BUILD_ID } from '../shared/constants';
import { HighlightRenderer, OperationLedger, type BlackoutAppearance, type EngineMode, type OperationType } from '../engine';
import { fail, isProtocolMessage, makeError, ok, validateRequest, type Mode, type Request, type RuntimePhase, type RuntimeSnapshot, type SoftBlackoutError } from '../shared/protocol';
import { ManualSession } from './manual-session';
import { PoetryDraft } from './poetry';
import { PatternMask } from './pattern-mask';
import { PREFERENCES_KEY, validatePopupPreferences } from '../shared/settings';

declare global { interface Window { __softBlackoutInjected?: boolean; __softBlackoutRuntime?: RuntimeOwner } }
interface EngineAdapter {
  commitSelection(mode?: EngineMode, type?: OperationType, appearance?: BlackoutAppearance): unknown;
  commitRanges(ranges: readonly Range[], mode?: EngineMode, type?: OperationType, appearance?: BlackoutAppearance): unknown;
  undo(): boolean; redo(): boolean; reveal(operationId: string, segmentId: string): boolean;
  updateAppearance(operationId: string, appearance: BlackoutAppearance): boolean;
  inspect(operationId: string): { id: string; segmentIds: string[] } | null;
  state(): ReturnType<OperationLedger['state']>; reset(): void;
}
interface RuntimeOwner { buildId: string; phase: RuntimePhase; state(): RuntimeSnapshot; dispose(): boolean; engine: EngineAdapter }

const previous = window.__softBlackoutRuntime;
let shouldBoot = true;
if (previous?.buildId === BUILD_ID && previous.phase !== 'disposed') shouldBoot = false;
else if (previous) { try { shouldBoot = previous.dispose(); } catch { shouldBoot = false; } }
else if (window.__softBlackoutInjected) shouldBoot = false;

if (shouldBoot) {
  delete window.__softBlackoutInjected;
  let phase: RuntimePhase = 'initializing';
  let selectedMode: Mode = 'manual';
  let editingMode: 'manual' | 'poetry' | null = null;
  let styleClaimed = false;
  let lastError: SoftBlackoutError | null = null;
  const documentId = crypto.randomUUID();
  const ledger = new OperationLedger(new HighlightRenderer(), documentId);
  const poetry = new PoetryDraft(ledger);
  const pattern = new PatternMask(ledger);
  let manualSession: ManualSession;
  let poetrySession: ManualSession;
  const notifyPopup = (): void => { try { void chrome.runtime.sendMessage({ marker: 'soft-blackout-state-changed' }).catch(() => undefined); } catch { /* Popup is usually closed. */ } };

  const engine: EngineAdapter = {
    commitSelection(mode = 'manual', type = 'mask', appearance) {
      const selection = getSelection();
      const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)) : [];
      return ledger.commit(ranges, mode, type, appearance);
    },
    commitRanges: (ranges, mode = 'manual', type = 'mask', appearance) => ledger.commit(ranges, mode, type, appearance),
    undo: () => ledger.undo(), redo: () => ledger.redo(),
    reveal: (operationId, segmentId) => ledger.reveal(operationId, segmentId),
    updateAppearance: (operationId, appearance) => ledger.updateAppearance(operationId, appearance),
    inspect: (operationId) => ledger.inspect(operationId), state: () => ledger.state(), reset: () => ledger.reset(),
  };

  manualSession = new ManualSession({
    commit(range) { const committed = ledger.commit([range], 'manual', 'mask').ok; if (committed) notifyPopup(); return committed; },
    findRevealTarget(range) { return ledger.findRevealTarget(range); },
    reveal(target) { const revealed = ledger.reveal(target.operationId, target.segmentId); if (revealed) notifyPopup(); return revealed; },
    feedback(message) { manualSession.announce(message); }, done() { stopEditing(); },
  });
  poetrySession = new ManualSession({
    commit(range) { const result = poetry.add(range); if (!result.ok) poetrySession.announce(result.message); else notifyPopup(); return result.ok; },
    findRevealTarget(range) { return poetry.findRemoval(range); }, reveal(target) { const removed = poetry.remove(target); if (removed) notifyPopup(); return removed; },
    feedback(message) { poetrySession.announce(message === 'Text masked.' ? 'Selection kept for the poem.' : message === 'Mask revealed.' ? 'Selection removed from the poem.' : message); },
    done() { stopEditing(); },
  }, { activeTitle: 'Poetry composition active', instruction: 'Choose words to keep, then apply in the popup.', primary: 'Keep', remove: 'Remove from poem', done: 'Return to popup' });

  // In-page controls follow the popup theme preference (not the mask colour). Read once, then follow live changes.
  const applyTheme = (value: unknown): void => { const { theme, autoMask } = validatePopupPreferences(value); manualSession.setTheme(theme); poetrySession.setTheme(theme); manualSession.setAutoMask(autoMask); };
  const storageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => { if (area === 'local' && PREFERENCES_KEY in changes) applyTheme(changes[PREFERENCES_KEY]!.newValue); };
  try { chrome.storage.onChanged.addListener(storageListener); void chrome.storage.local.get(PREFERENCES_KEY).then((stored) => { if (phase !== 'disposed') applyTheme(stored[PREFERENCES_KEY]); }).catch(() => undefined); } catch { /* Storage unavailable: controls follow the system theme. */ }

  function stopEditing(): void {
    editingMode = null; manualSession.stop(); poetrySession.stop(); poetry.stop();
    notifyPopup();
  }
  function startManual(): void {
    pattern.cancel(); poetrySession.stop(); poetry.stop(); editingMode = 'manual'; selectedMode = 'manual'; manualSession.start();
  }
  function snapshot(): RuntimeSnapshot {
    const history = ledger.state(), poetryState = poetry.state(), patternState = pattern.state();
    return {
      buildId: BUILD_ID, documentId, phase, selectedMode,
      editing: { active: editingMode !== null, mode: editingMode },
      history: { canUndo: history.canUndo, canRedo: history.canRedo, undoCount: history.undoCount, redoCount: history.redoCount },
      manual: { maskedCount: ledger.activeSegmentsFor('manual'), invalidatedCount: history.invalidatedSegments },
      poetry: poetryState, pattern: patternState,
      pending: poetryState.keptCount > 0 || patternState.status !== 'idle', styleClaimed, appearance: ledger.appearance(), lastError,
    };
  }

  function requestResult(request: Request) {
    switch (request.type) {
      case 'PING': case 'GET_STATE': return ok(snapshot());
      case 'START_EDITING':
        if (poetry.state().keptCount) return fail(makeError('UNSUPPORTED_OPERATION', 'Discard or apply the pending Poetry composition first.', true));
        startManual(); return ok(snapshot());
      case 'START_POETRY': {
        pattern.cancel(); stopEditing(); selectedMode = 'poetry';
        const result = poetry.start(); if (!result.ok) return fail(makeError('UNSUPPORTED_OPERATION', result.message, true));
        editingMode = 'poetry'; poetrySession.start(); return ok(snapshot());
      }
      case 'STOP_EDITING': stopEditing(); return ok(snapshot());
      case 'APPLY_POETRY': {
        const result = poetry.apply(); if (!result.ok) return fail(makeError('UNSUPPORTED_OPERATION', result.message, true));
        stopEditing(); return ok(snapshot());
      }
      case 'CLEAR_POETRY': poetry.clear(); return ok(snapshot());
      case 'DISCARD_POETRY': poetry.discard(); stopEditing(); return ok(snapshot());
      case 'EDIT_POETRY': {
        pattern.cancel(); stopEditing(); const result = poetry.editLatest();
        if (!result.ok) return fail(makeError('UNSUPPORTED_OPERATION', result.message, true));
        selectedMode = 'poetry'; editingMode = 'poetry'; poetrySession.start(); return ok(snapshot());
      }
      case 'CANCEL_POETRY_EDIT': poetry.cancelEdit(); stopEditing(); return ok(snapshot());
      case 'SCAN_PATTERNS': {
        if (poetry.state().keptCount) return fail(makeError('UNSUPPORTED_OPERATION', 'Discard or apply the pending Poetry composition first.', true));
        stopEditing(); selectedMode = 'pattern-mask'; const result = pattern.scan(request.payload);
        if (!result.ok) return fail(makeError('UNSUPPORTED_OPERATION', result.message, true));
        return ok(snapshot());
      }
      case 'APPLY_PATTERNS': {
        const result = pattern.apply(); if (!result.ok) return fail(makeError('UNSUPPORTED_OPERATION', result.message, true));
        return ok(snapshot());
      }
      case 'CANCEL_PATTERN_SCAN': pattern.cancel(); return ok(snapshot());
      case 'SET_APPEARANCE':
        if (!ledger.setAppearance(request.payload)) return fail(makeError('INVALID_MESSAGE', 'Invalid blackout appearance.', false));
        return ok(snapshot());
      case 'UNDO': if (!ledger.undo()) return fail(makeError('UNSUPPORTED_OPERATION', 'Nothing to undo.', true)); return ok(snapshot());
      case 'REDO': if (!ledger.redo()) return fail(makeError('UNSUPPORTED_OPERATION', 'Nothing to redo.', true)); return ok(snapshot());
      case 'RESET': stopEditing(); poetry.reset(); pattern.reset(); ledger.reset(); lastError = null; return ok({ ...snapshot(), changed: 0 });
      case 'CLAIM_STYLE': { const claimed = !styleClaimed; styleClaimed = true; return ok({ ...snapshot(), claimed }); }
      case 'RELEASE_STYLE': styleClaimed = false; return ok(snapshot());
      case 'DISPOSE': { const buildId = BUILD_ID; disposeRuntime(); return ok({ disposed: true as const, buildId }); }
    }
  }

  const messageListener = (raw: unknown, _sender: chrome.runtime.MessageSender, respond: (response: unknown) => void): boolean | void => {
    if (!isProtocolMessage(raw)) return;
    const invalid = validateRequest(raw, BUILD_ID); if (invalid) { respond(fail(invalid)); return false; }
    if (phase === 'disposed') { respond(fail(makeError('RUNTIME_UNAVAILABLE', 'This page runtime has been disposed.', true))); return false; }
    try { lastError = null; respond(requestResult(raw as unknown as Request)); }
    catch (error) { lastError = makeError('INTERNAL', error instanceof Error ? error.message : 'Unexpected runtime failure.', true); respond(fail(lastError)); }
    return false;
  };
  function disposeRuntime(): boolean {
    if (phase === 'disposed') return true;
    phase = 'disposed'; let clean = true;
    try { stopEditing(); } catch { clean = false; }
    try { chrome.runtime.onMessage.removeListener(messageListener); chrome.storage.onChanged.removeListener(storageListener); } catch { clean = false; }
    try { poetry.dispose(); pattern.reset(); ledger.dispose(); } catch { clean = false; }
    styleClaimed = false; if (window.__softBlackoutRuntime === owner) delete window.__softBlackoutRuntime; return clean;
  }
  const owner: RuntimeOwner = { buildId: BUILD_ID, get phase() { return phase; }, state: snapshot, dispose: disposeRuntime, engine };
  window.__softBlackoutRuntime = owner;
  try { chrome.runtime.onMessage.addListener(messageListener); phase = 'ready'; }
  catch (error) { lastError = makeError('CLEANUP_FAILED', error instanceof Error ? error.message : 'Runtime initialization failed.', false); disposeRuntime(); throw error; }
}
