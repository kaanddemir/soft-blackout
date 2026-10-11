import { isEligibleTextNode } from '../engine/eligibility';
import type { OperationLedger } from '../engine/ledger';
import { validateRanges } from '../engine/ranges';
import { validatePatternCategories, type PatternCategories } from '../shared/settings';

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd';
const MAX_NODES = 10_000, MAX_CHARS = 250_000, MAX_MATCHES = 500;
type Category = 'email' | 'url' | 'phone';
interface Candidate { category: Category; start: number; end: number }
interface Planned { category: Category; range: Range; startNode: Node; startOffset: number; endNode: Node; endOffset: number }
export interface PatternState { status: 'idle' | 'scanned' | 'invalid'; counts: Record<Category, number>; total: number; categories: PatternCategories | null }
export type PatternResult = { ok: true } | { ok: false; message: string };

export function detectPatterns(text: string, categories: PatternCategories): Candidate[] {
  const found: Candidate[] = [];
  if (categories.email) {
    const re = /(?<![\w.!#$%&'*+/=?^`{|}~-])[A-Z0-9.!#$%&'*+=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+(?![\w@-]|\.[\w-])/giu;
    for (const match of text.matchAll(re)) if (match.index !== undefined && !match[0].includes('..')) found.push({ category: 'email', start: match.index, end: match.index + match[0].length });
  }
  if (categories.url) {
    const re = /(?<![\w@])(?:https?:\/\/|www\.)[^\s<>"'\u0000]+/giu;
    for (const match of text.matchAll(re)) if (match.index !== undefined) {
      let value = match[0];
      while (/[.,!?;:]$/.test(value) || (value.endsWith(')') && (value.match(/\(/g)?.length ?? 0) < (value.match(/\)/g)?.length ?? 0)) || (value.endsWith(']') && (value.match(/\[/g)?.length ?? 0) < (value.match(/\]/g)?.length ?? 0))) value = value.slice(0, -1);
      if (value.length > (value.startsWith('www.') ? 8 : 12)) found.push({ category: 'url', start: match.index, end: match.index + value.length });
    }
  }
  if (categories.phone) {
    const re = /(?<![\w.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\d{2,4}[ .-])\d{3,4}[ .-]\d{2,4}(?:[ .-]\d{2,4})?(?!\w|[ .-]\d)/g;
    for (const match of text.matchAll(re)) if (match.index !== undefined) {
      const digits = match[0].replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15 && /[()+ .-]/.test(match[0]) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(match[0])) found.push({ category: 'phone', start: match.index, end: match.index + match[0].length });
    }
  }
  // An address inside a URL (userinfo, query) belongs to the URL; otherwise email > URL > phone on overlap.
  const urls = found.filter((item) => item.category === 'url');
  for (let index = found.length - 1; index >= 0; index--) {
    const item = found[index]!;
    if (item.category === 'email' && urls.some((url) => url.start <= item.start && item.end <= url.end)) found.splice(index, 1);
  }
  const rank: Record<Category, number> = { email: 0, url: 1, phone: 2 };
  found.sort((a, b) => rank[a.category] - rank[b.category] || a.start - b.start || b.end - a.end);
  const accepted: Candidate[] = [];
  for (const item of found) if (!accepted.some((other) => item.start < other.end && other.start < item.end)) accepted.push(item);
  return accepted.sort((a, b) => a.start - b.start);
}

export class PatternMask {
  private planned: Planned[] = [];
  private categories: PatternCategories | null = null;
  private status: PatternState['status'] = 'idle';
  constructor(private readonly ledger: OperationLedger) {}

  scan(value: unknown): PatternResult {
    if (matchMedia('(forced-colors: active)').matches) return { ok: false, message: 'Pattern masking is unavailable while forced colors are active.' };
    const categories = validatePatternCategories(value);
    if (!categories.email && !categories.url && !categories.phone) return { ok: false, message: 'Choose at least one pattern category.' };
    const blocks = document.querySelectorAll(BLOCKS);
    // Cheap pre-count (no style reads) so oversized pages are refused before the expensive eligibility pass.
    let estimate = 0;
    for (const block of blocks) {
      const counter = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (counter.nextNode()) if (++estimate > MAX_NODES) return { ok: false, message: 'This page is too large to scan safely.' };
    }
    const plan: Planned[] = []; let nodeCount = 0, charCount = 0;
    for (const block of blocks) {
      // One segment per text node (ineligible nodes become a single NUL separator) instead of one object per character.
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); const segments: Array<{ node: Text | null; start: number }> = []; let text = '';
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (++nodeCount > MAX_NODES) return { ok: false, message: 'This page is too large to scan safely.' };
        if (!isEligibleTextNode(node, 'automatic')) { segments.push({ node: null, start: text.length }); text += '\0'; continue; }
        if ((charCount += node.length) > MAX_CHARS) return { ok: false, message: 'This page contains too much text to scan safely.' };
        segments.push({ node, start: text.length }); text += node.data;
      }
      const locate = (index: number): { node: Text; offset: number } | null => {
        let low = 0, high = segments.length - 1;
        while (low < high) { const mid = (low + high + 1) >> 1; if (segments[mid]!.start <= index) low = mid; else high = mid - 1; }
        const segment = segments[low]; return segment?.node ? { node: segment.node, offset: index - segment.start } : null;
      };
      for (const candidate of detectPatterns(text, categories)) {
        const start = locate(candidate.start), last = locate(candidate.end - 1);
        if (!start || !last || text.slice(candidate.start, candidate.end).includes('\0')) continue;
        const range = document.createRange(); range.setStart(start.node, start.offset); range.setEnd(last.node, last.offset + 1);
        const valid = validateRanges([range], 'automatic'); if (!valid.ok) continue;
        const exact = valid.ranges[0]!;
        if (this.ledger.intersectsActive(exact)) continue; // Already masked by any mode: not an applicable match.
        const duplicate = plan.some((item) => item.startNode === exact.startContainer && item.startOffset === exact.startOffset && item.endNode === exact.endContainer && item.endOffset === exact.endOffset);
        if (duplicate) continue;
        plan.push({ category: candidate.category, range: exact, startNode: exact.startContainer, startOffset: exact.startOffset, endNode: exact.endContainer, endOffset: exact.endOffset });
        if (plan.length > MAX_MATCHES) return { ok: false, message: 'Too many matches were found. Narrow the categories.' };
      }
    }
    this.planned = plan; this.categories = categories; this.status = 'scanned'; return { ok: true };
  }

  apply(): PatternResult {
    if (this.status !== 'scanned') return { ok: false, message: 'Scan the page before applying masks.' };
    if (matchMedia('(forced-colors: active)').matches) return { ok: false, message: 'Pattern masking is unavailable while forced colors are active.' };
    if (!this.planned.length) return { ok: false, message: 'No supported patterns were found.' };
    for (const item of this.planned) if (!item.startNode.isConnected || !item.endNode.isConnected || item.range.startContainer !== item.startNode || item.range.startOffset !== item.startOffset || item.range.endContainer !== item.endNode || item.range.endOffset !== item.endOffset) {
      this.status = 'invalid'; return { ok: false, message: 'The page changed. Scan again before applying.' };
    }
    const valid = validateRanges(this.planned.map((item) => item.range), 'automatic');
    if (!valid.ok) { this.status = 'invalid'; return { ok: false, message: 'The page changed. Scan again before applying.' }; }
    const committed = this.ledger.commit(valid.ranges, 'pattern-mask', 'pattern-batch');
    if (!committed.ok) return { ok: false, message: 'The matches could not be applied safely.' };
    this.cancel(); return { ok: true };
  }

  cancel(): void { this.planned = []; this.categories = null; this.status = 'idle'; }
  reset(): void { this.cancel(); }
  state(): PatternState {
    const counts = { email: 0, url: 0, phone: 0 };
    for (const item of this.planned) counts[item.category]++;
    return { status: this.status, counts, total: this.planned.length, categories: this.categories ? { ...this.categories } : null };
  }
}
