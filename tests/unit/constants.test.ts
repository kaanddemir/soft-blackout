import { describe, expect, it } from 'vitest';
import { BUILD_ID, CONTENT_RUNTIME_FILE, CONTENT_STYLE_FILE, isRestrictedUrl } from '../../src/shared/constants';

describe('shared constants', () => {
  it('has development-safe build and runtime paths', () => {
    expect(BUILD_ID).toBe('dev');
    expect(CONTENT_RUNTIME_FILE).toBe('content/runtime.js');
    expect(CONTENT_STYLE_FILE).toBe('content/styles.css');
  });

  it.each([
    undefined,
    'chrome://settings',
    'chrome-extension://abc/page.html',
    'edge://extensions',
    'about:blank',
    'file:///tmp/page.html',
    'https://chromewebstore.google.com/detail/example/id',
    'https://chrome.google.com/webstore/detail/example/id',
    'not a url',
  ])('classifies %s as restricted', (url) => {
    expect(isRestrictedUrl(url)).toBe(true);
  });

  it.each(['https://example.com/article', 'http://127.0.0.1:3000/', 'https://chrome.google.com/search?q=webstore'])('allows %s', (url) => {
    expect(isRestrictedUrl(url)).toBe(false);
  });
});
