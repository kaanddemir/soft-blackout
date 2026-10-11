import { Window } from 'happy-dom';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { detectPatterns, PatternMask } from '../../src/content/pattern-mask';
import { OperationLedger } from '../../src/engine/ledger';
import type { BlackoutRenderer, RenderedMask } from '../../src/engine/renderer';

class MemoryRenderer implements BlackoutRenderer { masks: readonly RenderedMask[]=[]; render(masks:readonly RenderedMask[]){this.masks=masks;return{active:masks.length,invalidated:[]}} clear(){this.masks=[]} dispose(){this.clear()} }
let window: Window;
beforeEach(()=>{window=new Window({url:'https://example.test'});Object.assign(globalThis,{window,document:window.document,Node:window.Node,Text:window.Text,Element:window.Element,HTMLElement:window.HTMLElement,Document:window.Document,ShadowRoot:window.ShadowRoot,Range:window.Range,NodeFilter:window.NodeFilter,getComputedStyle:window.getComputedStyle.bind(window),matchMedia:()=>({matches:false})});});
afterEach(()=>window.close());
const all={email:true,url:true,phone:true};

describe('pattern detection',()=>{
  it('matches conservative emails and rejects malformed boundaries',()=>{
    const text='hello@example.com, support+team@example.co.uk bad..x@example.com x@y and ahello@example.comz';
    expect(detectPatterns(text,{email:true,url:false,phone:false}).map(x=>text.slice(x.start,x.end))).toEqual(['hello@example.com','support+team@example.co.uk','ahello@example.comz']);
  });
  it('supports approved URL prefixes and trims prose punctuation',()=>{
    const text='See https://example.com/a?q=1#x, www.example.org/path). Ignore example.net.';
    expect(detectPatterns(text,{email:false,url:true,phone:false}).map(x=>text.slice(x.start,x.end))).toEqual(['https://example.com/a?q=1#x','www.example.org/path']);
  });
  it('accepts formatted phones while rejecting plain numbers, dates, versions, and identifiers',()=>{
    const text='+90 532 123 45 67; +1 (415) 555-2671; (212) 555-0123; 1234567890 2026-10-11 v1.2.3 id212-555-0123';
    expect(detectPatterns(text,{email:false,url:false,phone:true}).map(x=>text.slice(x.start,x.end))).toEqual(['+90 532 123 45 67','+1 (415) 555-2671','(212) 555-0123']);
  });
  it('applies email-before-URL-before-phone precedence without overlaps',()=>{
    const text='mail hello@example.com and https://example.com/+1-415-555-2671';
    const matches=detectPatterns(text,all);expect(matches.map(x=>x.category)).toEqual(['email','url']);
  });
});

describe('PatternMask scan lifecycle',()=>{
  it('maps cross-inline matches, scans without masking, applies one batch, and supports Undo/Redo',()=>{
    document.body.innerHTML='<p>Contact hello@<strong>example.com</strong> or visit https://example.org.</p><nav><p>skip@nav.com</p></nav>';
    const renderer=new MemoryRenderer(),ledger=new OperationLedger(renderer,'doc'),pattern=new PatternMask(ledger);
    expect(pattern.scan({email:true,url:true,phone:false}).ok).toBe(true);expect(pattern.state()).toMatchObject({total:2,counts:{email:1,url:1,phone:0}});expect(renderer.masks).toHaveLength(0);
    expect(pattern.apply().ok).toBe(true);expect(renderer.masks).toHaveLength(2);expect(ledger.state().undoCount).toBe(1);
    ledger.undo();expect(renderer.masks).toHaveLength(0);ledger.redo();expect(renderer.masks).toHaveLength(2);
  });
  it('cancels scans and refuses atomic Apply after DOM replacement',()=>{
    document.body.innerHTML='<p id="x">hello@example.com</p>';
    const renderer=new MemoryRenderer(),ledger=new OperationLedger(renderer,'doc'),pattern=new PatternMask(ledger);
    pattern.scan({email:true,url:false,phone:false});pattern.cancel();expect(pattern.state().status).toBe('idle');
    pattern.scan({email:true,url:false,phone:false});document.querySelector('#x')!.replaceWith(document.createElement('p'));
    expect(pattern.apply()).toMatchObject({ok:false});expect(renderer.masks).toHaveLength(0);expect(ledger.state().undoCount).toBe(0);
  });
  it('deduplicates the same match discovered through nested semantic blocks',()=>{
    document.body.innerHTML='<blockquote><p>hello@example.com</p></blockquote>';
    const pattern=new PatternMask(new OperationLedger(new MemoryRenderer(),'doc'));
    expect(pattern.scan({email:true,url:false,phone:false}).ok).toBe(true);
    expect(pattern.state()).toMatchObject({total:1,counts:{email:1,url:0,phone:0}});
  });
});

describe('detector boundary audit (Phase 10)', () => {
  const all = { email: true, url: true, phone: true };
  const found = (text: string) => detectPatterns(text, all).map((item) => `${item.category}:${text.slice(item.start, item.end)}`);
  it.each([
    ['Mail jane.doe+tag@example.co.uk.', ['email:jane.doe+tag@example.co.uk']],
    ['mailto:hi@example.com', ['email:hi@example.com']],
    ['https://user@example.com/path', ['url:https://user@example.com/path']],
    ['See https://example.com/a_(b)?x=1&y=2#frag.', ['url:https://example.com/a_(b)?x=1&y=2#frag']],
    ['Call 415-555-0132.', ['phone:415-555-0132']],
    ['Call +1 (415) 555-0132 now', ['phone:+1 (415) 555-0132']],
    ['UK +44 20 7946 0958 office', ['phone:+44 20 7946 0958']],
    ['Tel: 030 1234 5678', ['phone:030 1234 5678']],
  ])('matches %s', (text, expected) => expect(found(text)).toEqual(expected));
  it.each([
    'user@localhost', 'x@@y.com', 'http://x', 'ftp://example.com', 'ID 1234567890', 'Order 2026-10-11', 'version 10.2.3.4567',
    'IP 192.168.100.200', '1 000 000 000', 'ISBN 978-3-16-148410-0', 'card 4111 1111 1111 1111', 'Range 2019-2024 2025-2030', 'price 1,234,567.89',
  ])('stays conservative for %s', (text) => expect(found(text)).toEqual([]));
});
