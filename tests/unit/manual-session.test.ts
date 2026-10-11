import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualSession } from '../../src/content/manual-session';

let window: Window;
let forcedColors = false;

beforeEach(() => {
  window = new Window({ url: 'https://example.test/' });
  forcedColors = false;
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, Text: window.Text, Element: window.Element,
    HTMLElement: window.HTMLElement, Document: window.Document, ShadowRoot: window.ShadowRoot,
    Range: window.Range, NodeFilter: window.NodeFilter, PointerEvent: window.PointerEvent,
    KeyboardEvent: window.KeyboardEvent, getComputedStyle: window.getComputedStyle.bind(window),
    matchMedia: (query: string) => ({ matches: forcedColors && query.includes('forced-colors'), media: query }),
    requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 1; },
    cancelAnimationFrame: () => undefined,
  });
  Object.defineProperties(window.Range.prototype, {
    getClientRects: { configurable: true, value: () => [{ left: 20, right: 80, top: 30, bottom: 50, width: 60, height: 20 }] },
    getBoundingClientRect: { configurable: true, value: () => ({ left: 20, right: 80, top: 30, bottom: 50, width: 60, height: 20 }) },
  });
});
afterEach(() => window.close());

async function select(text: Text, start: number, end: number): Promise<void> {
  const range = document.createRange(); range.setStart(text, start); range.setEnd(text, end);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range as never);
  document.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0 }) as unknown as Event);
  await Promise.resolve();
}

describe('ManualSession', () => {
  it('requires confirmation, supports Cancel and Escape, and cleans listeners on stop', async () => {
    const commit = vi.fn((_range: Range) => true), feedback = vi.fn(), done = vi.fn();
    const session = new ManualSession({ commit, feedback, done, findRevealTarget: () => null, reveal: () => false });
    document.body.innerHTML = '<p>select this text</p>';
    const text = document.querySelector('p')!.firstChild as Text;
    session.start(); session.start();
    expect(document.querySelectorAll('[data-soft-blackout-owned="manual-indicator"]')).toHaveLength(1);
    await select(text, 0, 6);
    const host = document.querySelector<HTMLElement>('[data-soft-blackout-owned="manual-context"]')!;
    expect(commit).not.toHaveBeenCalled();
    host.shadowRoot!.querySelector<HTMLButtonElement>('[data-cancel]')!.click();
    expect(commit).not.toHaveBeenCalled();
    await select(text, 7, 11);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }) as unknown as Event);
    expect(document.querySelector('[data-soft-blackout-owned="manual-context"]')).toBeNull();
    expect(session.isActive()).toBe(true);
    session.stop(); session.stop();
    expect(document.querySelector('[data-soft-blackout-owned]')).toBeNull();
    await select(text, 0, 4);
    expect(document.querySelector('[data-soft-blackout-owned]')).toBeNull();
  });

  it('commits exact pending ranges and refuses forced-color masking', async () => {
    const commit = vi.fn((_range: Range) => true), feedback = vi.fn();
    const session = new ManualSession({ commit, feedback, done: vi.fn(), findRevealTarget: () => null, reveal: () => false });
    document.body.innerHTML = '<p>partialword</p>';
    const text = document.querySelector('p')!.firstChild as Text;
    session.start(); await select(text, 2, 8);
    document.querySelector<HTMLElement>('[data-soft-blackout-owned="manual-context"]')!.shadowRoot!.querySelector<HTMLButtonElement>('[data-primary]')!.click();
    expect(commit).toHaveBeenCalledOnce();
    expect((commit.mock.calls[0]![0] as Range).toString()).toBe('rtialw');
    forcedColors = true; await select(text, 0, 2);
    expect(document.querySelector('[data-soft-blackout-owned="manual-context"]')).toBeNull();
    expect(feedback).toHaveBeenCalledWith('Visual masking is unavailable while forced colors are active.');
  });
});
