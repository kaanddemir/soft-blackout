import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverText, isEligibleTextNode } from '../../src/engine/eligibility';
import { validateAppearance } from '../../src/engine/appearance';
import { validateRanges } from '../../src/engine/ranges';
import { OperationLedger } from '../../src/engine/ledger';
import type { BlackoutRenderer, RenderedMask } from '../../src/engine/renderer';

class MemoryRenderer implements BlackoutRenderer {
  masks: readonly RenderedMask[] = [];
  disposed = 0;
  render(masks: readonly RenderedMask[]) { this.masks = masks.filter((mask) => mask.range.startContainer.isConnected); return { active: this.masks.length, invalidated: masks.filter((mask) => !mask.range.startContainer.isConnected).map((mask) => mask.id) }; }
  clear() { this.masks = []; }
  dispose() { this.clear(); this.disposed++; }
}

let window: Window;
beforeEach(() => {
  window = new Window({ url: 'https://example.test/' });
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, Text: window.Text, Element: window.Element,
    Document: window.Document, ShadowRoot: window.ShadowRoot, Range: window.Range,
    NodeFilter: window.NodeFilter, getComputedStyle: window.getComputedStyle.bind(window),
  });
});
afterEach(() => window.close());

function range(node: Text, start: number, end: number): Range {
  const result = document.createRange(); result.setStart(node, start); result.setEnd(node, end); return result;
}

describe('text eligibility and bounded discovery', () => {
  it('supports nested Unicode and RTL text while excluding controls and hidden content', () => {
    document.body.innerHTML = '<article><p>Plain <strong>café שלום</strong></p><button>action</button><div hidden>hidden</div><div contenteditable="true">edit</div></article>';
    const result = discoverText(document, 'manual');
    expect(result.nodes.map((node) => node.data)).toEqual(['Plain ', 'café שלום']);
    expect(isEligibleTextNode(document.querySelector('button')!.firstChild!)).toBe(false);
  });

  it('uses stricter automatic boundaries and reports discovery limits', () => {
    document.body.innerHTML = '<main><p>article</p><nav>navigation</nav><a href="/x">link</a></main>';
    expect(discoverText(document, 'automatic').nodes.map((node) => node.data)).toEqual(['article']);
    expect(discoverText(document, 'manual', 1).truncated).toBe(true);
  });
});

describe('range validation', () => {
  it('preserves partial words, duplicate strings, ordering, and multi-node boundaries', () => {
    document.body.innerHTML = '<p><span>repeat alpha</span><em> beta repeat</em></p>';
    const first = document.querySelector('span')!.firstChild as Text;
    const second = document.querySelector('em')!.firstChild as Text;
    const multi = document.createRange(); multi.setStart(first, 7); multi.setEnd(second, 5);
    const validated = validateRanges([range(second, 6, 12), range(first, 0, 6), multi]);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.ranges.map((item) => item.toString())).toEqual(['repeat', 'alpha beta', 'repeat']);
  });

  it('rejects collapsed, detached, ineligible, cross-root, and excessive ranges', () => {
    const text = document.body.appendChild(document.createTextNode('visible'));
    expect(validateRanges([range(text, 1, 1)])).toEqual({ ok: false, error: 'EMPTY_RANGE' });
    const detached = document.createTextNode('gone');
    expect(validateRanges([range(detached, 0, 2)])).toEqual({ ok: false, error: 'DETACHED_NODE' });
    document.body.innerHTML = '<p>safe</p><button>unsafe</button>';
    const mixed = document.createRange(); mixed.setStart(document.querySelector('p')!.firstChild!, 0); mixed.setEnd(document.querySelector('button')!.firstChild!, 3);
    expect(validateRanges([mixed])).toEqual({ ok: false, error: 'INELIGIBLE_CONTENT' });
    const host = document.body.appendChild(document.createElement('div'));
    const shadow = host.attachShadow({ mode: 'open' }); shadow.textContent = 'shadow';
    const shadowRange = document.createRange(); shadowRange.setStart(shadow.firstChild!, 0); shadowRange.setEnd(shadow.firstChild!, 3);
    expect(validateRanges([range(document.querySelector('p')!.firstChild as Text, 0, 3), shadowRange])).toEqual({ ok: false, error: 'CROSS_ROOT' });
  });
});

describe('operation ledger', () => {
  it('handles overlap ownership, exact undo/redo, redo clearing, reveal, and appearance updates', () => {
    const renderer = new MemoryRenderer(); const ledger = new OperationLedger(renderer, 'doc');
    const text = document.body.appendChild(document.createTextNode('abcdefghij'));
    const first = ledger.commit([range(text, 1, 6)], 'manual', 'mask');
    const second = ledger.commit([range(text, 4, 9)], 'pattern-mask', 'pattern-batch');
    expect(first.ok && second.ok).toBe(true); expect(renderer.masks).toHaveLength(2);
    expect(ledger.findRevealTarget(range(text, 4, 5))).toBeNull();
    expect(ledger.findRevealTarget(range(text, 2, 3))?.operationId).toBe(first.ok ? first.operationId : '');
    expect(ledger.undo()).toBe(true); expect(renderer.masks).toHaveLength(1);
    expect(ledger.redo()).toBe(true); expect(renderer.masks).toHaveLength(2);
    if (!first.ok) throw new Error();
    const segment = ledger.inspect(first.operationId)!.segmentIds[0]!;
    expect(ledger.reveal(first.operationId, segment)).toBe(true); expect(renderer.masks).toHaveLength(1);
    expect(ledger.undo()).toBe(true); expect(renderer.masks).toHaveLength(2);
    expect(ledger.undo()).toBe(true); expect(renderer.masks).toHaveLength(1);
    const third = ledger.commit([range(text, 0, 1)], 'manual', 'mask', { style: 'marker', color: '#a65d51' });
    expect(third.ok).toBe(true); expect(ledger.state().canRedo).toBe(false);
    expect(ledger.updateAppearance(first.operationId, { style: 'solid', color: '#65786c' })).toBe(true);
    const history = ledger.state();
    expect(ledger.setAppearance({ style: 'marker', color: '#a8977c' })).toBe(true);
    expect(ledger.state()).toMatchObject({ undoCount: history.undoCount, redoCount: history.redoCount });
    expect(renderer.masks.every((mask) => mask.appearance.style === 'marker' && mask.appearance.color === '#a8977c')).toBe(true);
  });

  it('creates no history for invalid work and resets/disposes idempotently', () => {
    const renderer = new MemoryRenderer(); const ledger = new OperationLedger(renderer, 'doc');
    expect(ledger.commit([], 'manual', 'mask')).toEqual({ ok: false, error: 'EMPTY_RANGE' });
    expect(ledger.state().canUndo).toBe(false);
    ledger.reset(); ledger.reset(); ledger.dispose(); ledger.dispose();
    expect(renderer.masks).toHaveLength(0);
  });

  it('reports disconnected ranges without rematching equal text', () => {
    const renderer = new MemoryRenderer(); const ledger = new OperationLedger(renderer, 'doc');
    const original = document.body.appendChild(document.createTextNode('same'));
    const committed = ledger.commit([range(original, 0, 4)], 'manual', 'mask');
    original.remove(); document.body.appendChild(document.createTextNode('same'));
    if (!committed.ok) throw new Error();
    ledger.updateAppearance(committed.operationId, { style: 'solid', color: '#242321' });
    expect(ledger.state().invalidatedSegments).toBe(1); expect(renderer.masks).toHaveLength(0);
  });
});

describe('appearance configuration', () => {
  it('accepts only curated Solid and Marker combinations', () => {
    expect(validateAppearance({ style: 'solid', color: '#242321' })).toEqual({ style: 'solid', color: '#242321' });
    expect(validateAppearance({ style: 'blur', color: '#242321' })).toBeNull();
    expect(validateAppearance({ style: 'solid', color: '#123456' })).toBeNull();
  });
});

describe('history capacity', () => {
  it('does not let discarded undone operations exhaust the operation limit', () => {
    document.body.innerHTML = '<p>alpha beta gamma</p>';
    const text = document.querySelector('p')!.firstChild as Text;
    const ledger = new OperationLedger(new MemoryRenderer(), 'doc');
    // Commit then undo far more than MAX_OPERATIONS (100) times; each new commit discards the previous redo entry.
    for (let index = 0; index < 150; index++) {
      expect(ledger.commit([range(text, 0, 5)], 'manual', 'mask').ok).toBe(true);
      expect(ledger.undo()).toBe(true);
    }
    expect(ledger.commit([range(text, 6, 10)], 'manual', 'mask').ok).toBe(true);
    expect(ledger.state()).toMatchObject({ activeOperations: 1, undoCount: 1, redoCount: 0 });
  });

  it('keeps operations that redo can still restore', () => {
    document.body.innerHTML = '<p>alpha beta</p>';
    const text = document.querySelector('p')!.firstChild as Text;
    const ledger = new OperationLedger(new MemoryRenderer(), 'doc');
    ledger.commit([range(text, 0, 5)], 'manual', 'mask'); ledger.undo();
    expect(ledger.redo()).toBe(true);
    expect(ledger.state().activeSegments).toBe(1);
  });
});
