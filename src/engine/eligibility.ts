const ALWAYS_EXCLUDED = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
  'BUTTON', 'OBJECT', 'EMBED', 'IFRAME', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO',
]);

const AUTO_EXCLUDED = 'nav,menu,[role="navigation"],[role="menu"],[role="toolbar"],a[href],[tabindex]:not([tabindex="-1"])';
const HIDDEN_STYLE = new Set(['none', 'hidden', 'collapse']);

export type DiscoveryKind = 'manual' | 'automatic';

export function isSupportedRoot(root: Node): root is Document | ShadowRoot {
  return root.nodeType === Node.DOCUMENT_NODE
    || (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root && (root as ShadowRoot).mode === 'open');
}

function ownsExtensionUi(element: Element): boolean {
  if (element.hasAttribute('data-soft-blackout-owned') || element.closest('[data-soft-blackout-owned]')) return true;
  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof Element
    && (root.host.hasAttribute('data-soft-blackout-owned') || Boolean(root.host.closest('[data-soft-blackout-owned]')));
}

export function isEligibleTextNode(node: Node, kind: DiscoveryKind = 'manual'): node is Text {
  if (!(node instanceof Text) || !node.isConnected || node.data.length === 0) return false;
  const root = node.getRootNode();
  if (!isSupportedRoot(root)) return false;
  const parent = node.parentElement;
  if (!parent || ALWAYS_EXCLUDED.has(parent.tagName) || ownsExtensionUi(parent)) return false;
  if (parent.closest('script,style,noscript,template,input,textarea,select,button,object,embed,iframe,[hidden],[inert],[aria-hidden="true"],[role="textbox"]')) return false;
  if (parent.closest('[contenteditable]:not([contenteditable="false"])')) return false;
  if (kind === 'automatic' && parent.closest(AUTO_EXCLUDED)) return false;
  for (let current: Element | null = parent; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (HIDDEN_STYLE.has(style.display) || HIDDEN_STYLE.has(style.visibility)) return false;
  }
  return true;
}

export interface DiscoveryResult {
  nodes: Text[];
  truncated: boolean;
}

export function discoverText(root: Document | ShadowRoot | Element, kind: DiscoveryKind, limit = 10_000): DiscoveryResult {
  if (!Number.isSafeInteger(limit) || limit < 1) return { nodes: [], truncated: true };
  const document = root.nodeType === Node.DOCUMENT_NODE ? root as Document : root.ownerDocument!;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Element && ALWAYS_EXCLUDED.has(node.tagName)) return NodeFilter.FILTER_REJECT;
      if (node instanceof Text) return isEligibleTextNode(node, kind) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text) {
      if (nodes.length === limit) return { nodes, truncated: true };
      nodes.push(walker.currentNode);
    }
  }
  return { nodes, truncated: false };
}
