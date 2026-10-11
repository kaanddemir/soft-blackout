import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('production constraints', () => {
  it('does not introduce a service worker or automatic content script', () => {
    const manifest = read('src/manifest.json');
    expect(manifest).not.toContain('service_worker');
    expect(manifest).not.toContain('content_scripts');
  });

  it('keeps release source maps disabled and version synchronization explicit', () => {
    const build = read('scripts/build.mjs');
    expect(build).toContain("sourcemap: watch ? 'linked' : false");
    expect(build).toContain('manifest.version = pkg.version');
  });

  it('keeps the popup English-only without Chrome i18n plumbing', () => {
    const html = read('src/ui/popup/index.html');
    const popup = read('src/ui/popup/popup.ts');
    expect(html).not.toContain('data-i18n');
    expect(popup).not.toContain('chrome.i18n');
  });

  it('does not persist per-tab editing state or webpage content', () => {
    const popup = read('src/ui/popup/popup.ts');
    expect(popup).not.toContain('redactionMode_tab_');
    expect(popup).toContain('PATTERN_PREFERENCES_KEY');
    expect(popup).not.toContain('maskedText');
    expect(popup).not.toContain('textContent:');
  });
});
