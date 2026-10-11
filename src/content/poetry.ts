import { discoverText } from '../engine/eligibility';
import type { OperationLedger, RevealTarget } from '../engine/ledger';
import { rangeIsLive, validateRanges } from '../engine/ranges';

const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd';
const PREVIEW_NAME = 'soft-blackout-poetry-preview';
const MAX_KEEPS = 100;

interface Keep { id: string; range: Range; block: Element }
interface Revision { operationId: string; keeps: Keep[] }
interface Composition { id: string; revisions: Revision[] }

export interface PoetryState {
  active: boolean; keptCount: number; blockCount: number; editing: boolean;
  canApply: boolean; canEdit: boolean; compositionCount: number; invalid: boolean;
}

export type PoetryResult = { ok: true; operationId?: string } | { ok: false; message: string };
type PlanResult = { ok: true; ranges: Range[] } | { ok: false; message: string };

function closestBlock(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(BLOCK_SELECTOR) ?? null;
}

function rangesOverlap(a: Range, b: Range): boolean {
  try {
    const aStart = a.cloneRange(), aEnd = a.cloneRange(), bStart = b.cloneRange(), bEnd = b.cloneRange();
    aStart.collapse(true); aEnd.collapse(false); bStart.collapse(true); bEnd.collapse(false);
    return aStart.compareBoundaryPoints(Range.START_TO_START, bEnd) < 0
      && bStart.compareBoundaryPoints(Range.START_TO_START, aEnd) < 0;
  } catch { return false; }
}

function cloneKeep(keep: Keep): Keep { return { id: crypto.randomUUID(), range: keep.range.cloneRange(), block: keep.block }; }

export class PoetryDraft {
  private keeps: Keep[] = [];
  private compositions: Composition[] = [];
  private editingComposition: Composition | null = null;
  private editingRevision: Revision | null = null;
  private styleRoots = new Set<Document | ShadowRoot>();
  private active = false;
  private invalid = false;

  constructor(private readonly ledger: OperationLedger) {}

  start(): PoetryResult {
    if (matchMedia('(forced-colors: active)').matches) return { ok: false, message: 'Poetry masking is unavailable while forced colors are active.' };
    this.active = true; this.renderPreview(); return { ok: true };
  }

  stop(): void { this.active = false; }

  add(range: Range): PoetryResult {
    if (!this.active) return { ok: false, message: 'Start composing first.' };
    if (this.keeps.length >= MAX_KEEPS) return { ok: false, message: 'This composition has too many kept selections.' };
    const validation = validateRanges([range]);
    if (!validation.ok) return { ok: false, message: 'That selection cannot be kept.' };
    const exact = validation.ranges[0]!;
    const startBlock = closestBlock(exact.startContainer), endBlock = closestBlock(exact.endContainer);
    if (!startBlock || startBlock !== endBlock) return { ok: false, message: 'Choose text within one paragraph or reading block.' };
    if (this.ledger.intersectsActive(exact, this.editingRevision?.operationId)) return { ok: false, message: 'That text is already masked by another operation.' };
    if (this.keeps.some((keep) => rangesOverlap(keep.range, exact))) return { ok: false, message: 'That selection overlaps words already kept.' };
    this.keeps.push({ id: crypto.randomUUID(), range: exact, block: startBlock });
    this.renderPreview(); return { ok: true };
  }

  findRemoval(range: Range): RevealTarget | null {
    const matches = this.keeps.filter((keep) => {
      try { return keep.range.compareBoundaryPoints(Range.START_TO_START, range) <= 0 && keep.range.compareBoundaryPoints(Range.END_TO_END, range) >= 0; }
      catch { return false; }
    });
    return matches.length === 1 ? { operationId: 'poetry-draft', segmentId: matches[0]!.id } : null;
  }

  remove(target: RevealTarget): boolean {
    const index = this.keeps.findIndex((keep) => keep.id === target.segmentId);
    if (target.operationId !== 'poetry-draft' || index < 0) return false;
    this.keeps.splice(index, 1); this.renderPreview(); return true;
  }

  clear(): void { this.keeps = []; this.invalid = false; this.renderPreview(); }

  discard(): void {
    this.clear(); this.editingComposition = null; this.editingRevision = null; this.active = false;
  }

  apply(): PoetryResult {
    if (matchMedia('(forced-colors: active)').matches) return { ok: false, message: 'Poetry masking is unavailable while forced colors are active.' };
    if (!this.keeps.length) return { ok: false, message: 'Keep at least one word before applying.' };
    const planned = this.planComplements();
    if (!planned.ok) { this.invalid = true; return planned; }
    const result = this.editingRevision
      ? this.ledger.replace(this.editingRevision.operationId, planned.ranges, this.ledger.appearance())
      : this.ledger.commit(planned.ranges, 'poetry', 'composition');
    if (!result.ok) return { ok: false, message: 'The composition could not be applied safely.' };
    const revision = { operationId: result.operationId, keeps: this.keeps.map(cloneKeep) };
    if (this.editingComposition) this.editingComposition.revisions.push(revision);
    else this.compositions.push({ id: crypto.randomUUID(), revisions: [revision] });
    this.keeps = []; this.editingComposition = null; this.editingRevision = null; this.invalid = false;
    this.clearPreview(); this.active = false;
    return { ok: true, operationId: result.operationId };
  }

  editLatest(): PoetryResult {
    const composition = [...this.compositions].reverse().find((candidate) => candidate.revisions.some((revision) => this.ledger.operationActive(revision.operationId)));
    const revision = composition?.revisions.find((candidate) => this.ledger.operationActive(candidate.operationId));
    if (!composition || !revision || revision.keeps.some((keep) => !rangeIsLive(keep.range))) return { ok: false, message: 'No valid applied composition is available to edit.' };
    this.editingComposition = composition; this.editingRevision = revision;
    this.keeps = revision.keeps.map(cloneKeep); this.active = true; this.renderPreview();
    return { ok: true };
  }

  cancelEdit(): void { this.keeps = []; this.editingComposition = null; this.editingRevision = null; this.active = false; this.clearPreview(); }
  reset(): void { this.discard(); this.compositions = []; }
  dispose(): void { this.reset(); for (const root of this.styleRoots) root.querySelector('[data-soft-blackout-owned="poetry-preview-style"]')?.remove(); this.styleRoots.clear(); }

  state(): PoetryState {
    const live = this.keeps.filter((keep) => rangeIsLive(keep.range));
    return {
      active: this.active, keptCount: live.length, blockCount: new Set(live.map((keep) => keep.block)).size,
      editing: Boolean(this.editingRevision), canApply: live.length > 0,
      canEdit: this.compositions.some((composition) => composition.revisions.some((revision) => this.ledger.operationActive(revision.operationId))),
      compositionCount: this.compositions.length, invalid: this.invalid || live.length !== this.keeps.length,
    };
  }

  private planComplements(): PlanResult {
    const ranges: Range[] = [];
    for (const block of new Set(this.keeps.map((keep) => keep.block))) {
      if (!block.isConnected) return { ok: false, message: 'The page changed. Review the composition again.' };
      const discovered = discoverText(block, 'manual', 5_000);
      if (discovered.truncated) return { ok: false, message: 'This reading block is too large.' };
      const blockKeeps = this.keeps.filter((keep) => keep.block === block);
      for (const node of discovered.nodes) {
        const intervals: Array<[number, number]> = [];
        for (const keep of blockKeeps) {
          try {
            if (!keep.range.intersectsNode(node)) continue;
            const start = keep.range.startContainer === node ? keep.range.startOffset : 0;
            const end = keep.range.endContainer === node ? keep.range.endOffset : node.length;
            if (end > start) intervals.push([start, end]);
          } catch { return { ok: false, message: 'The page changed. Review the composition again.' }; }
        }
        intervals.sort((a, b) => a[0] - b[0]);
        const merged: Array<[number, number]> = [];
        for (const interval of intervals) {
          const previous = merged.at(-1);
          if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
          else merged.push([...interval]);
        }
        let cursor = 0;
        for (const [start, end] of merged) {
          if (start > cursor) ranges.push(this.nodeRange(node, cursor, start));
          cursor = Math.max(cursor, end);
        }
        if (cursor < node.length) ranges.push(this.nodeRange(node, cursor, node.length));
      }
    }
    if (!ranges.length) return { ok: false, message: 'The selected blocks contain nothing else to mask.' };
    const validation = validateRanges(ranges);
    return validation.ok ? { ok: true, ranges: validation.ranges } : { ok: false, message: 'The composition exceeds the safe processing limits.' };
  }

  private nodeRange(node: Text, start: number, end: number): Range { const range = node.ownerDocument.createRange(); range.setStart(node, start); range.setEnd(node, end); return range; }

  private renderPreview(): void {
    this.clearPreview();
    const ranges = this.keeps.filter((keep) => rangeIsLive(keep.range)).map((keep) => keep.range);
    if (!ranges.length || matchMedia('(forced-colors: active)').matches) return;
    for (const keep of this.keeps) this.ensureStyle(keep.range.startContainer.getRootNode() as Document | ShadowRoot);
    CSS.highlights.set(PREVIEW_NAME, new Highlight(...ranges));
  }

  private clearPreview(): void { CSS.highlights.delete(PREVIEW_NAME); }
  private ensureStyle(root: Document | ShadowRoot): void {
    if (this.styleRoots.has(root)) return;
    const document = root.nodeType === Node.DOCUMENT_NODE ? root as Document : root.ownerDocument!;
    const style = document.createElement('style'); style.dataset.softBlackoutOwned = 'poetry-preview-style';
    style.textContent = `::highlight(${PREVIEW_NAME}){background-color:#f2c66d!important;color:inherit!important;text-decoration:underline 2px #7c4a16!important;text-underline-offset:3px!important}@media(forced-colors:active){::highlight(${PREVIEW_NAME}){background-color:transparent!important;color:inherit!important;text-decoration:none!important}}`;
    if (root.nodeType === Node.DOCUMENT_NODE) (document.head ?? document.documentElement).append(style); else root.append(style);
    this.styleRoots.add(root);
  }
}
