import { isEligibleTextNode, isSupportedRoot, type DiscoveryKind } from './eligibility';

export const MAX_RANGES_PER_OPERATION = 500;
export const MAX_CHARACTERS_PER_OPERATION = 100_000;

export type RangeValidationError =
  | 'EMPTY_RANGE' | 'INVALID_BOUNDARY' | 'CROSS_ROOT' | 'DETACHED_NODE'
  | 'INELIGIBLE_CONTENT' | 'RANGE_LIMIT' | 'CHARACTER_LIMIT';

export type RangeValidationResult =
  | { ok: true; ranges: Range[]; root: Document | ShadowRoot; characterCount: number }
  | { ok: false; error: RangeValidationError };

function boundaryIsValid(node: Node, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0) return false;
  return node instanceof Text ? offset <= node.length : offset <= node.childNodes.length;
}

function rangeTextNodes(range: Range): Text[] {
  const root = range.commonAncestorContainer;
  if (root instanceof Text) return [root];
  const walker = range.startContainer.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      try { return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
      catch { return NodeFilter.FILTER_REJECT; }
    },
  });
  if (!walker) return [];
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

export function rangeIsLive(range: Range): boolean {
  return range.startContainer.isConnected && range.endContainer.isConnected
    && range.startContainer.getRootNode() === range.endContainer.getRootNode();
}

export function validateRanges(input: readonly Range[], kind: DiscoveryKind = 'manual'): RangeValidationResult {
  if (input.length === 0) return { ok: false, error: 'EMPTY_RANGE' };
  if (input.length > MAX_RANGES_PER_OPERATION) return { ok: false, error: 'RANGE_LIMIT' };
  const clones: Range[] = [];
  let expectedRoot: Document | ShadowRoot | null = null;
  let characterCount = 0;
  for (const source of input) {
    if (!boundaryIsValid(source.startContainer, source.startOffset) || !boundaryIsValid(source.endContainer, source.endOffset)) return { ok: false, error: 'INVALID_BOUNDARY' };
    if (source.collapsed) return { ok: false, error: 'EMPTY_RANGE' };
    if (!source.startContainer.isConnected || !source.endContainer.isConnected) return { ok: false, error: 'DETACHED_NODE' };
    const startRoot = source.startContainer.getRootNode();
    if (startRoot !== source.endContainer.getRootNode() || !isSupportedRoot(startRoot)) return { ok: false, error: 'CROSS_ROOT' };
    if (expectedRoot && expectedRoot !== startRoot) return { ok: false, error: 'CROSS_ROOT' };
    expectedRoot = startRoot;
    const textNodes = rangeTextNodes(source);
    if (textNodes.length === 0 || textNodes.some((node) => !isEligibleTextNode(node, kind))) return { ok: false, error: 'INELIGIBLE_CONTENT' };
    const clone = source.cloneRange();
    characterCount += clone.toString().length;
    if (characterCount > MAX_CHARACTERS_PER_OPERATION) return { ok: false, error: 'CHARACTER_LIMIT' };
    clones.push(clone);
  }
  clones.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
  return { ok: true, ranges: clones, root: expectedRoot!, characterCount };
}
