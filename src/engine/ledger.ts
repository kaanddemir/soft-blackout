import { DEFAULT_APPEARANCE, validateAppearance, type BlackoutAppearance } from './appearance';
import type { BlackoutRenderer, RenderedMask } from './renderer';
import { rangeIsLive, validateRanges, type RangeValidationError } from './ranges';
import type { DiscoveryKind } from './eligibility';

export type EngineMode = 'manual' | 'poetry' | 'pattern-mask';
export type OperationType = 'mask' | 'composition' | 'pattern-batch';

interface Segment {
  id: string; range: Range; active: boolean;
  startContainer: Node; startOffset: number; endContainer: Node; endOffset: number;
}
export interface BlackoutOperation {
  id: string; documentId: string; mode: EngineMode; type: OperationType; root: Document | ShadowRoot;
  appearance: BlackoutAppearance; order: number; active: boolean; segments: Segment[];
}
type Command = { kind: 'operation'; operationId: string }
  | { kind: 'segment'; operationId: string; segmentId: string }
  | { kind: 'revision'; previousId: string; nextId: string };
export interface EngineState { activeOperations: number; activeSegments: number; invalidatedSegments: number; canUndo: boolean; canRedo: boolean; undoCount: number; redoCount: number }
export interface RevealTarget { operationId: string; segmentId: string }
export type CommitResult = { ok: true; operationId: string; state: EngineState } | { ok: false; error: RangeValidationError | 'INVALID_APPEARANCE' | 'HISTORY_LIMIT' };

const MAX_OPERATIONS = 100;
const MAX_COMMANDS = 200;

export class OperationLedger {
  private readonly operations = new Map<string, BlackoutOperation>();
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private order = 0;
  private invalidatedSegments = 0;
  private defaultAppearance: BlackoutAppearance = { ...DEFAULT_APPEARANCE };

  constructor(private readonly renderer: BlackoutRenderer, private readonly documentId: string) {}

  commit(ranges: readonly Range[], mode: EngineMode, type: OperationType, appearanceValue: unknown = this.defaultAppearance, kind: DiscoveryKind = 'manual'): CommitResult {
    if (this.operations.size >= MAX_OPERATIONS) return { ok: false, error: 'HISTORY_LIMIT' };
    const appearance = validateAppearance(appearanceValue);
    if (!appearance) return { ok: false, error: 'INVALID_APPEARANCE' };
    const validated = validateRanges(ranges, kind);
    if (!validated.ok) return validated;
    const id = crypto.randomUUID();
    const operation: BlackoutOperation = {
      id, documentId: this.documentId, mode, type, root: validated.root, appearance, order: ++this.order, active: true,
      segments: validated.ranges.map((range) => ({
        id: crypto.randomUUID(), range, active: true,
        startContainer: range.startContainer, startOffset: range.startOffset,
        endContainer: range.endContainer, endOffset: range.endOffset,
      })),
    };
    this.operations.set(id, operation);
    this.push(this.undoStack, { kind: 'operation', operationId: id });
    this.discardRedo();
    this.render();
    return { ok: true, operationId: id, state: this.state() };
  }

  replace(previousId: string, ranges: readonly Range[], appearanceValue: unknown = this.defaultAppearance): CommitResult {
    if (this.operations.size >= MAX_OPERATIONS) return { ok: false, error: 'HISTORY_LIMIT' };
    const previous = this.operations.get(previousId);
    if (!previous?.active || previous.type !== 'composition') return { ok: false, error: 'INVALID_APPEARANCE' };
    const appearance = validateAppearance(appearanceValue);
    if (!appearance) return { ok: false, error: 'INVALID_APPEARANCE' };
    const validated = validateRanges(ranges, 'manual');
    if (!validated.ok) return validated;
    const id = crypto.randomUUID();
    const operation: BlackoutOperation = {
      id, documentId: this.documentId, mode: 'poetry', type: 'composition', root: validated.root,
      appearance, order: ++this.order, active: true,
      segments: validated.ranges.map((range) => ({
        id: crypto.randomUUID(), range, active: true,
        startContainer: range.startContainer, startOffset: range.startOffset,
        endContainer: range.endContainer, endOffset: range.endOffset,
      })),
    };
    previous.active = false;
    this.operations.set(id, operation);
    this.push(this.undoStack, { kind: 'revision', previousId, nextId: id });
    this.discardRedo();
    this.render();
    return { ok: true, operationId: id, state: this.state() };
  }

  operationActive(id: string): boolean { return this.operations.get(id)?.active === true; }
  activeSegmentsFor(mode: EngineMode): number {
    let count = 0;
    for (const operation of this.operations.values()) if (operation.active && operation.mode === mode) count += operation.segments.filter((segment) => segment.active).length;
    return count;
  }

  intersectsActive(range: Range, ignoreOperationId?: string): boolean {
    for (const operation of this.operations.values()) if (operation.active && operation.id !== ignoreOperationId) {
      for (const segment of operation.segments) if (segment.active && rangeIsLive(segment.range)) {
        try {
          const aStart = range.cloneRange(), aEnd = range.cloneRange(), bStart = segment.range.cloneRange(), bEnd = segment.range.cloneRange();
          aStart.collapse(true); aEnd.collapse(false); bStart.collapse(true); bEnd.collapse(false);
          if (aStart.compareBoundaryPoints(Range.START_TO_START, bEnd) < 0
            && bStart.compareBoundaryPoints(Range.START_TO_START, aEnd) < 0) return true;
        } catch { /* Different roots cannot overlap. */ }
      }
    }
    return false;
  }

  reveal(operationId: string, segmentId: string): boolean {
    const operation = this.operations.get(operationId);
    const segment = operation?.segments.find((candidate) => candidate.id === segmentId);
    if (!operation?.active || !segment?.active) return false;
    segment.active = false;
    this.push(this.undoStack, { kind: 'segment', operationId, segmentId });
    this.discardRedo();
    this.render();
    return true;
  }

  findRevealTarget(range: Range): RevealTarget | null {
    const candidates: RevealTarget[] = [];
    for (const operation of this.operations.values()) if (operation.active) {
      for (const segment of operation.segments) if (segment.active && rangeIsLive(segment.range)) {
        try {
          const contains = segment.range.compareBoundaryPoints(Range.START_TO_START, range) <= 0
            && segment.range.compareBoundaryPoints(Range.END_TO_END, range) >= 0;
          if (contains) candidates.push({ operationId: operation.id, segmentId: segment.id });
        } catch { /* Different or invalid roots cannot be reveal targets. */ }
      }
    }
    return candidates.length === 1 ? candidates[0]! : null;
  }

  undo(): boolean { return this.move(this.undoStack, this.redoStack, false); }
  redo(): boolean { return this.move(this.redoStack, this.undoStack, true); }

  updateAppearance(operationId: string, value: unknown): boolean {
    const appearance = validateAppearance(value);
    const operation = this.operations.get(operationId);
    if (!appearance || !operation) return false;
    operation.appearance = appearance;
    this.render();
    return true;
  }

  setAppearance(value: unknown): boolean {
    const appearance = validateAppearance(value);
    if (!appearance) return false;
    this.defaultAppearance = appearance;
    for (const operation of this.operations.values()) operation.appearance = { ...appearance };
    this.render();
    return true;
  }

  appearance(): BlackoutAppearance { return { ...this.defaultAppearance }; }

  reset(): void { this.operations.clear(); this.undoStack = []; this.redoStack = []; this.invalidatedSegments = 0; this.renderer.clear(); }
  dispose(): void { this.reset(); this.renderer.dispose(); }

  state(): EngineState {
    let activeOperations = 0, activeSegments = 0;
    for (const operation of this.operations.values()) if (operation.active) {
      activeOperations++;
      activeSegments += operation.segments.filter((segment) => segment.active).length;
    }
    return {
      activeOperations, activeSegments, invalidatedSegments: this.invalidatedSegments,
      canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0,
      undoCount: this.undoStack.length, redoCount: this.redoStack.length,
    };
  }

  inspect(operationId: string): { id: string; segmentIds: string[] } | null {
    const operation = this.operations.get(operationId);
    return operation ? { id: operation.id, segmentIds: operation.segments.map((segment) => segment.id) } : null;
  }

  private move(from: Command[], to: Command[], active: boolean): boolean {
    const command = from.pop();
    if (!command) return false;
    if (command.kind === 'revision') {
      const previous = this.operations.get(command.previousId), next = this.operations.get(command.nextId);
      if (!previous || !next) return false;
      previous.active = !active;
      next.active = active;
    } else {
      const operation = this.operations.get(command.operationId);
      if (!operation) return false;
      if (command.kind === 'operation') operation.active = active;
      else {
      const segment = operation.segments.find((candidate) => candidate.id === command.segmentId);
      if (!segment) return false;
      segment.active = !active;
      }
    }
    this.push(to, command);
    this.render();
    return true;
  }

  private render(): void {
    const masks: RenderedMask[] = [];
    let invalidated = 0;
    for (const operation of this.operations.values()) if (operation.active) {
      for (const segment of operation.segments) if (segment.active) {
        const exact = rangeIsLive(segment.range)
          && segment.startContainer.isConnected && segment.endContainer.isConnected
          && segment.range.startContainer === segment.startContainer && segment.range.startOffset === segment.startOffset
          && segment.range.endContainer === segment.endContainer && segment.range.endOffset === segment.endOffset;
        if (exact) masks.push({ id: segment.id, range: segment.range, appearance: operation.appearance });
        else invalidated++;
      }
    }
    const result = this.renderer.render(masks);
    this.invalidatedSegments = invalidated + result.invalidated.length;
  }

  /** Drops redo history and any inactive operation no remaining command can restore, so undone work never counts against MAX_OPERATIONS. */
  private discardRedo(): void {
    this.redoStack = [];
    const referenced = new Set<string>();
    for (const command of this.undoStack) {
      if (command.kind === 'revision') { referenced.add(command.previousId); referenced.add(command.nextId); } else referenced.add(command.operationId);
    }
    for (const [id, operation] of this.operations) if (!operation.active && !referenced.has(id)) this.operations.delete(id);
  }

  private push(stack: Command[], command: Command): void {
    stack.push(command);
    if (stack.length > MAX_COMMANDS) stack.splice(0, stack.length - MAX_COMMANDS);
  }
}
