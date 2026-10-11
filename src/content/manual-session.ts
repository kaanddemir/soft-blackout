import { validateRanges, type RangeValidationError } from '../engine/ranges';
import type { RevealTarget } from '../engine/ledger';
import type { ThemePreference } from '../shared/settings';

type PendingAction = 'mask' | 'reveal';

export interface ManualSessionCallbacks {
  commit(range: Range): boolean;
  findRevealTarget(range: Range): RevealTarget | null;
  reveal(target: RevealTarget): boolean;
  feedback(message: string): void;
  done(): void;
}

export interface SelectionSessionLabels {
  activeTitle: string;
  instruction: string;
  primary: string;
  remove: string;
  done: string;
  autoInstruction?: string;
}

const MANUAL_LABELS: SelectionSessionLabels = {
  activeTitle: 'Manual mode active', instruction: 'Select text, then choose Mask.',
  primary: 'Mask', remove: 'Reveal', done: 'Done',
  autoInstruction: 'Select text to mask it.',
};

const ERROR_MESSAGES: Record<RangeValidationError, string> = {
  EMPTY_RANGE: 'Select some text first.',
  INVALID_BOUNDARY: 'That selection is no longer available.',
  CROSS_ROOT: 'Select text within one page section.',
  DETACHED_NODE: 'The page changed. Select the text again.',
  INELIGIBLE_CONTENT: 'That text cannot be masked.',
  RANGE_LIMIT: 'That selection is too complex.',
  CHARACTER_LIMIT: 'That selection is too large.',
};

export class ManualSession {
  private active = false;
  private pending: { range: Range; action: PendingAction; target: RevealTarget | null; focus: Element | null } | null = null;
  private indicatorHost: HTMLDivElement | null = null;
  private contextHost: HTMLDivElement | null = null;
  private resizeFrame = 0;
  private theme: ThemePreference = 'system';
  private autoMask = false;

  constructor(private readonly callbacks: ManualSessionCallbacks, private readonly labels: SelectionSessionLabels = MANUAL_LABELS) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('scroll', this.onViewportChange, true);
    window.addEventListener('resize', this.onViewportChange);
    this.showIndicator();
  }

  stop(): void {
    if (!this.active && !this.indicatorHost && !this.contextHost) return;
    this.active = false;
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = 0;
    this.dismiss(false);
    this.indicatorHost?.remove();
    this.indicatorHost = null;
  }

  /** Applies the user's Soft Blackout theme to existing and future in-page controls. */
  setTheme(theme: ThemePreference): void {
    this.theme = theme;
    for (const host of [this.indicatorHost, this.contextHost]) if (host) this.applyTheme(host);
  }

  /** Mask on select: pointer selections are masked without the confirmation. Reveal still asks. */
  setAutoMask(enabled: boolean): void {
    if (!this.labels.autoInstruction) return;
    this.autoMask = enabled;
    this.announce(this.instruction());
  }

  private instruction(): string {
    return this.autoMask && this.labels.autoInstruction ? this.labels.autoInstruction : this.labels.instruction;
  }

  private applyTheme(host: HTMLElement): void {
    if (this.theme === 'system') delete host.dataset.theme; else host.dataset.theme = this.theme;
  }

  isActive(): boolean { return this.active; }
  hasPending(): boolean { return this.pending !== null; }

  announce(message: string): void {
    const hint = this.indicatorHost?.shadowRoot?.querySelector<HTMLElement>('.hint');
    if (hint) hint.textContent = message;
  }

  // Starting a new click or drag elsewhere abandons the pending confirmation instead of leaving it on screen.
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.pending || this.ownedEvent(event)) return;
    this.pending = null;
    this.contextHost?.remove();
    this.contextHost = null;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0 || this.ownedEvent(event)) return;
    queueMicrotask(() => this.captureSelection(false));
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.ownedEvent(event) || (!event.shiftKey && !['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))) return;
    queueMicrotask(() => this.captureSelection(true));
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.pending) return;
    event.preventDefault();
    event.stopPropagation();
    this.dismiss(true);
    this.callbacks.feedback('Selection cancelled.');
  };

  private readonly onViewportChange = (): void => {
    if (!this.pending || this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      if (!this.pending || !this.positionContext(this.pending.range)) this.dismiss(false);
    });
  };

  private ownedEvent(event: Event): boolean {
    return event.composedPath().some((node) => node instanceof HTMLElement && node.dataset.softBlackoutOwned !== undefined);
  }

  private captureSelection(fromKeyboard: boolean): void {
    if (!this.active) return;
    if (matchMedia('(forced-colors: active)').matches) {
      this.dismiss(false);
      this.callbacks.feedback('Visual masking is unavailable while forced colors are active.');
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) { if (this.pending) this.dismiss(false); return; }
    const range = selection.getRangeAt(0).cloneRange();
    const validation = validateRanges([range]);
    if (!validation.ok) {
      this.dismiss(false);
      this.callbacks.feedback(ERROR_MESSAGES[validation.error]);
      return;
    }
    const validRange = validation.ranges[0]!;
    const target = this.callbacks.findRevealTarget(validRange);
    this.pending = { range: validRange, action: target ? 'reveal' : 'mask', target, focus: document.activeElement };
    // Keyboard selections grow one character at a time, so they always confirm.
    if (this.autoMask && !fromKeyboard && !target) { this.confirm(); return; }
    this.showContext(fromKeyboard);
  }

  private showIndicator(): void {
    if (this.indicatorHost?.isConnected) return;
    const host = document.createElement('div');
    host.dataset.softBlackoutOwned = 'manual-indicator';
    this.applyTheme(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${this.sharedStyles()}
      :host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646}
      .panel{display:flex;align-items:center;gap:12px;max-width:calc(100vw - 32px);padding:8px 8px 8px 12px;background:var(--sb-surface);color:var(--sb-text);border:1px solid var(--sb-border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.16);font:13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif}
      strong{display:block;font-size:13px;font-weight:600;white-space:nowrap}.hint{display:block;color:var(--sb-muted);font-size:12px}button{flex:none}button{background:var(--sb-primary);color:var(--sb-on-primary)}
    </style><div class="panel"><div><strong>${this.labels.activeTitle}</strong><span class="hint" aria-live="polite">${this.instruction()}</span></div><button type="button">${this.labels.done}</button></div>`;
    shadow.querySelector('button')!.addEventListener('click', () => this.callbacks.done());
    document.documentElement.append(host);
    this.indicatorHost = host;
  }

  private showContext(focus: boolean): void {
    this.contextHost?.remove();
    const pending = this.pending;
    if (!pending) return;
    const host = document.createElement('div');
    host.dataset.softBlackoutOwned = 'manual-context';
    this.applyTheme(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const actionLabel = pending.action === 'reveal' ? this.labels.remove : this.labels.primary;
    shadow.innerHTML = `<style>${this.sharedStyles()}
      :host{all:initial;position:fixed;z-index:2147483647}
      .panel{display:flex;gap:4px;padding:4px;background:var(--sb-surface);border:1px solid var(--sb-border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18)}
      button[data-primary]{background:var(--sb-primary);color:var(--sb-on-primary)}button[data-cancel]{background:transparent;color:var(--sb-text)}button[data-cancel]:hover{background:var(--sb-hover)}
    </style><div class="panel" role="group" aria-label="Selected text actions"><button data-primary type="button">${actionLabel}</button><button data-cancel type="button">Cancel</button></div>`;
    const primary = shadow.querySelector<HTMLButtonElement>('[data-primary]')!;
    primary.addEventListener('click', () => this.confirm());
    shadow.querySelector<HTMLButtonElement>('[data-cancel]')!.addEventListener('click', () => { this.dismiss(true); this.callbacks.feedback('Selection cancelled.'); });
    document.documentElement.append(host);
    this.contextHost = host;
    if (!this.positionContext(pending.range)) { this.dismiss(false); return; }
    if (focus) primary.focus({ preventScroll: true });
  }

  private confirm(): void {
    const pending = this.pending;
    if (!pending) return;
    if (matchMedia('(forced-colors: active)').matches) {
      this.callbacks.feedback('Visual masking is unavailable while forced colors are active.');
      this.dismiss(true);
      return;
    }
    const validation = validateRanges([pending.range]);
    if (!validation.ok) {
      this.callbacks.feedback(ERROR_MESSAGES[validation.error]);
      this.dismiss(true);
      return;
    }
    let success = false;
    if (pending.action === 'reveal' && pending.target) {
      const current = this.callbacks.findRevealTarget(validation.ranges[0]!);
      success = Boolean(current && current.operationId === pending.target.operationId && current.segmentId === pending.target.segmentId && this.callbacks.reveal(current));
    } else success = this.callbacks.commit(validation.ranges[0]!);
    this.callbacks.feedback(success ? (pending.action === 'reveal' ? 'Mask revealed.' : 'Text masked.') : 'The page changed. Select the text again.');
    this.dismiss(true);
  }

  private dismiss(restoreFocus: boolean): void {
    const focus = this.pending?.focus;
    this.pending = null;
    this.contextHost?.remove();
    this.contextHost = null;
    window.getSelection()?.removeAllRanges();
    if (restoreFocus && focus instanceof HTMLElement && focus.isConnected) focus.focus({ preventScroll: true });
  }

  private positionContext(range: Range): boolean {
    const host = this.contextHost;
    if (!host || !range.startContainer.isConnected || !range.endContainer.isConnected) return false;
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    // One line: sit above that line. Several lines: sit above the whole selection, so tight headings
    // (line-height below font size) do not put the control over the selected text.
    const first = rects[0], last = rects.at(-1);
    const multiline = !!first && !!last && last.top - first.top > first.height / 2;
    const anchor = (multiline ? null : last) ?? range.getBoundingClientRect();
    if (!anchor.width && !anchor.height) return false;
    const { width, height } = host.getBoundingClientRect(), gap = 8;
    const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 8);
    const above = anchor.top - height - gap;
    const top = above >= 8 ? above : Math.min(window.innerHeight - height - 8, anchor.bottom + gap);
    host.style.left = `${left}px`; host.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    return true;
  }

  private sharedStyles(): string {
    const light = '--sb-surface:#f6f3ee;--sb-text:#242321;--sb-muted:#6b655d;--sb-border:#ded9d1;--sb-hover:#eae6e0;--sb-primary:#242321;--sb-on-primary:#fff';
    const dark = '--sb-surface:#252525;--sb-text:#f1ede6;--sb-muted:#aaa49b;--sb-border:#424242;--sb-hover:#303030;--sb-primary:#eae3d8;--sb-on-primary:#171717';
    return `:host{color-scheme:light;${light}}:host([data-theme=dark]){color-scheme:dark;${dark}}@media(prefers-color-scheme:dark){:host(:not([data-theme=light])){color-scheme:dark;${dark}}}*{box-sizing:border-box}button{appearance:none;display:inline-flex;align-items:center;justify-content:center;min-width:56px;height:28px;border:0;border-radius:6px;padding:0 12px;font:500 13px/1 system-ui,-apple-system,'Segoe UI',sans-serif;white-space:nowrap;cursor:pointer}button:focus-visible{outline:2px solid var(--sb-text);outline-offset:2px}@media(forced-colors:active){button{border:1px solid ButtonText}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}`;
  }
}
