import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../src/manifest.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('extension manifest', () => {
  it('is MV3 with a build-owned source version', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe('0.0.0');
    expect(pkg.version).toBe('2.0.0');
  });

  it('uses only the approved user-initiated permissions', () => {
    expect([...manifest.permissions].sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest).not.toHaveProperty('background');
  });

  it('requires Chrome 116, matching the esbuild target', () => {
    expect(manifest.minimum_chrome_version).toBe('116');
    expect(readFileSync('scripts/build.mjs', 'utf8')).toContain("target: 'chrome116'");
  });

  it('points at the built popup layout', () => {
    expect(manifest.action.default_popup).toBe('popup/index.html');
  });

  it('uses direct English metadata without locale infrastructure', () => {
    expect(manifest.name).toBe('Soft Blackout');
    expect(manifest.description).toBe('Visually mask text on web pages: hide words by hand, make blackout poems, or cover emails, links and phone numbers.');
    expect(manifest).not.toHaveProperty('default_locale');
    expect(JSON.stringify(manifest)).not.toContain('__MSG_');
  });
});
