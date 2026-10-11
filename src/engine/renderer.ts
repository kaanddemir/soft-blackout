import { appearanceKey, BLACKOUT_COLORS, type BlackoutAppearance } from './appearance';
import { rangeIsLive } from './ranges';

export interface RenderedMask { id: string; range: Range; appearance: BlackoutAppearance }

export interface BlackoutRenderer {
  render(masks: readonly RenderedMask[]): { active: number; invalidated: string[] };
  clear(): void;
  dispose(): void;
}

const PREFIX = 'soft-blackout-v2-';

export class HighlightRenderer implements BlackoutRenderer {
  private readonly roots = new Set<Document | ShadowRoot>();
  private readonly names = new Set<string>();
  private disposed = false;

  render(masks: readonly RenderedMask[]): { active: number; invalidated: string[] } {
    if (this.disposed) throw new Error('Renderer is disposed.');
    this.clearHighlights();
    const grouped = new Map<string, Range[]>();
    const invalidated: string[] = [];
    for (const mask of masks) {
      if (!rangeIsLive(mask.range)) { invalidated.push(mask.id); continue; }
      const root = mask.range.startContainer.getRootNode() as Document | ShadowRoot;
      this.ensureStyles(root);
      const key = appearanceKey(mask.appearance);
      const name = `${PREFIX}${key}`;
      const ranges = grouped.get(name) ?? [];
      ranges.push(mask.range);
      grouped.set(name, ranges);
    }
    for (const [name, ranges] of grouped) {
      CSS.highlights.set(name, new Highlight(...ranges));
      this.names.add(name);
    }
    return { active: masks.length - invalidated.length, invalidated };
  }

  clear(): void { this.clearHighlights(); }

  dispose(): void {
    if (this.disposed) return;
    this.clearHighlights();
    for (const root of this.roots) root.querySelector(`[data-soft-blackout-owned="engine-styles"]`)?.remove();
    this.roots.clear();
    this.disposed = true;
  }

  private clearHighlights(): void {
    for (const name of this.names) CSS.highlights.delete(name);
    this.names.clear();
  }

  private ensureStyles(root: Document | ShadowRoot): void {
    if (this.roots.has(root)) return;
    const isDocument = root.nodeType === Node.DOCUMENT_NODE;
    const document = isDocument ? root as Document : root.ownerDocument!;
    const style = document.createElement('style');
    style.dataset.softBlackoutOwned = 'engine-styles';
    const solid = BLACKOUT_COLORS.map((color) => `::highlight(${PREFIX}solid-${color.slice(1)})`).join(',');
    const marker = BLACKOUT_COLORS.map((color) => `::highlight(${PREFIX}marker-${color.slice(1)})`).join(',');
    style.textContent = [
      `${solid}{color:transparent!important;text-shadow:none!important}`,
      ...BLACKOUT_COLORS.map((color) => `::highlight(${PREFIX}solid-${color.slice(1)}){background-color:${color}!important}`),
      // ::highlight() ignores background images, so Marker is a thick centred line-through band (narrower than the
      // line box, unlike Solid). Glyphs stay transparent either way, so text is obscured even if decoration is unsupported.
      ...BLACKOUT_COLORS.map((color) => `::highlight(${PREFIX}marker-${color.slice(1)}){background-color:transparent!important;color:transparent!important;text-shadow:none!important;text-decoration:line-through ${color} 0.72em!important;text-decoration-skip-ink:none!important}`),
      `@media(forced-colors:active){${solid},${marker}{background:transparent!important;color:inherit!important;text-shadow:inherit!important;text-decoration:none!important}}`,
    ].join('');
    if (isDocument) (document.head ?? document.documentElement).append(style);
    else root.append(style);
    this.roots.add(root);
  }
}
