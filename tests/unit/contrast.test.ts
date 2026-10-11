import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.2 contrast for the popup and in-page tokens, read from the real stylesheets so token edits are checked.
const css = readFileSync('src/ui/popup/popup.css', 'utf8');
const inPage = readFileSync('src/content/manual-session.ts', 'utf8');
const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')));
const dark = tokens(css.slice(css.indexOf(":root[data-theme='dark'] {"), css.indexOf('/* Base */')));
const luminance = (hex: string) => {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe.each([['light', light], ['dark', dark]] as const)('%s popup contrast', (_name, t) => {
  it.each([
    ['text', 'canvas'], ['text', 'surface'], ['text', 'surface-2'], ['muted', 'canvas'], ['muted', 'surface'], ['muted', 'surface-2'],
    ['on-primary', 'primary'], ['on-primary', 'primary-hover'], ['error', 'canvas'],
  ])('%s on %s meets 4.5:1', (fg, bg) => expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5));
  it.each([['focus', 'canvas'], ['text', 'surface']])('%s indicator on %s meets 3:1 (SC 1.4.11)', (fg, bg) => expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(3));
});

describe('in-page control contrast', () => {
  const sets = [...inPage.matchAll(/const (light|dark) = '([^']+)'/g)].map((m) => tokens(m[2]!.replace(/;/g, ';\n')));
  it('defines light and dark in-page palettes', () => expect(sets).toHaveLength(2));
  it.each([0, 1])('palette %i text, muted and primary labels meet 4.5:1', (index) => {
    const t = sets[index]!;
    for (const [fg, bg] of [['sb-text', 'sb-surface'], ['sb-muted', 'sb-surface'], ['sb-on-primary', 'sb-primary'], ['sb-text', 'sb-hover']] as const) expect(ratio(t[fg]!, t[bg]!), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
