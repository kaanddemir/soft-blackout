import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PoetryDraft } from '../../src/content/poetry';
import { OperationLedger } from '../../src/engine/ledger';
import type { BlackoutRenderer, RenderedMask } from '../../src/engine/renderer';

class MemoryRenderer implements BlackoutRenderer {
  masks: readonly RenderedMask[] = [];
  render(masks: readonly RenderedMask[]) { this.masks = masks; return { active: masks.length, invalidated: [] }; }
  clear() { this.masks = []; }
  dispose() { this.clear(); }
}

let window: Window;
let highlights: Map<string, unknown>;
beforeEach(() => {
  window = new Window({ url: 'https://example.test/' }); highlights = new Map();
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, Text: window.Text, Element: window.Element,
    HTMLElement: window.HTMLElement, Document: window.Document, ShadowRoot: window.ShadowRoot,
    Range: window.Range, NodeFilter: window.NodeFilter, getComputedStyle: window.getComputedStyle.bind(window),
    matchMedia: () => ({ matches: false }), Highlight: class { constructor(..._ranges: Range[]) {} },
    CSS: { highlights: { set: (key: string, value: unknown) => highlights.set(key, value), delete: (key: string) => highlights.delete(key) } },
  });
});
afterEach(() => window.close());

function range(node: Text, start: number, end: number): Range { const value = document.createRange(); value.setStart(node, start); value.setEnd(node, end); return value; }

describe('PoetryDraft', () => {
  it('resolves semantic blocks and plans exact partial-word complements atomically', () => {
    document.body.innerHTML = '<p id="a">alpha <strong>partialword</strong> omega.</p><p id="b">unaffected text</p>';
    const renderer = new MemoryRenderer(), ledger = new OperationLedger(renderer, 'doc'), poetry = new PoetryDraft(ledger);
    const word = document.querySelector('strong')!.firstChild as Text;
    expect(poetry.start().ok).toBe(true);
    expect(poetry.add(range(word, 2, 8)).ok).toBe(true);
    expect(poetry.state()).toMatchObject({ keptCount: 1, blockCount: 1, canApply: true });
    expect(highlights.has('soft-blackout-poetry-preview')).toBe(true);
    expect(poetry.apply().ok).toBe(true);
    const masked = renderer.masks.map((mask) => mask.range.toString()).join('');
    expect(masked).toContain('alpha '); expect(masked).toContain('pa'); expect(masked).toContain('ord'); expect(masked).toContain(' omega.');
    expect(masked).not.toContain('rtialw'); expect(masked).not.toContain('unaffected text');
    expect(document.body.textContent).toBe('alpha partialword omega.unaffected text');
  });

  it('supports multi-block Unicode keeps, exact removal, clear, and invalid cross-block selections', () => {
    document.body.innerHTML = '<p id="a">Türkçe İstanbul.</p><p id="b">مرحبا بالعالم</p>';
    const renderer = new MemoryRenderer(), poetry = new PoetryDraft(new OperationLedger(renderer, 'doc'));
    const a = document.querySelector('#a')!.firstChild as Text, b = document.querySelector('#b')!.firstChild as Text;
    poetry.start(); expect(poetry.add(range(a, 0, 6)).ok).toBe(true); expect(poetry.add(range(b, 0, 5)).ok).toBe(true);
    expect(poetry.state()).toMatchObject({ keptCount: 2, blockCount: 2 });
    const target = poetry.findRemoval(range(a, 1, 3)); expect(target).not.toBeNull(); expect(poetry.remove(target!)).toBe(true);
    expect(poetry.state().keptCount).toBe(1); poetry.clear(); expect(poetry.state().keptCount).toBe(0);
    const cross = document.createRange(); cross.setStart(a, 0); cross.setEnd(b, 3);
    expect(poetry.add(cross)).toMatchObject({ ok: false });
  });

  it('revises an applied composition as one history command and restores it through Undo/Redo', () => {
    document.body.innerHTML = '<p>one two three</p>';
    const renderer = new MemoryRenderer(), ledger = new OperationLedger(renderer, 'doc'), poetry = new PoetryDraft(ledger);
    const text = document.querySelector('p')!.firstChild as Text;
    poetry.start(); poetry.add(range(text, 4, 7)); const first = poetry.apply(); expect(first.ok).toBe(true);
    expect(poetry.editLatest().ok).toBe(true); expect(poetry.add(range(text, 8, 13)).ok).toBe(true);
    const revised = poetry.apply(); expect(revised.ok).toBe(true);
    const revisedMasks = renderer.masks.map((mask) => mask.range.toString()).join('|');
    expect(ledger.undo()).toBe(true); expect(renderer.masks.map((mask) => mask.range.toString()).join('|')).not.toBe(revisedMasks);
    expect(ledger.redo()).toBe(true); expect(renderer.masks.map((mask) => mask.range.toString()).join('|')).toBe(revisedMasks);
  });

  it('prevents kept words from promising visibility through independent Manual masks', () => {
    document.body.innerHTML = '<p>one two three</p>';
    const renderer = new MemoryRenderer(), ledger = new OperationLedger(renderer, 'doc'), poetry = new PoetryDraft(ledger);
    const text = document.querySelector('p')!.firstChild as Text;
    ledger.commit([range(text, 4, 7)], 'manual', 'mask'); poetry.start();
    expect(poetry.add(range(text, 4, 7))).toMatchObject({ ok: false });
  });

  it('retains drafts when selection stops and fails atomically after block replacement', () => {
    document.body.innerHTML = '<p id="target">keep this draft</p>';
    const renderer = new MemoryRenderer(), ledger = new OperationLedger(renderer, 'doc'), poetry = new PoetryDraft(ledger);
    const text = document.querySelector('p')!.firstChild as Text;
    poetry.start(); poetry.add(range(text, 0, 4)); poetry.stop();
    expect(poetry.state()).toMatchObject({ active: false, keptCount: 1 });
    document.querySelector('#target')!.replaceWith(document.createElement('p'));
    expect(poetry.apply()).toMatchObject({ ok: false });
    expect(renderer.masks).toHaveLength(0); expect(ledger.state().undoCount).toBe(0);
  });
});
