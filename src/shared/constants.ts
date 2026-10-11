declare const __BUILD_ID__: string;

export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
export const CONTENT_RUNTIME_FILE = 'content/runtime.js';
export const CONTENT_STYLE_FILE = 'content/styles.css';

const RESTRICTED_PROTOCOLS = new Set(['about:', 'chrome:', 'chrome-extension:', 'devtools:', 'edge:', 'view-source:']);

export function isRestrictedUrl(value: string | undefined): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (RESTRICTED_PROTOCOLS.has(url.protocol)) return true;
    if (url.protocol === 'file:') return true;
    return url.hostname === 'chromewebstore.google.com' || url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore');
  } catch {
    return true;
  }
}
