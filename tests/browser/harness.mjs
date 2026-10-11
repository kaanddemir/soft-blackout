import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.resolve(here, '../../dist');
const FIXTURES = path.join(here, 'fixtures');

if (!process.env.PLAYWRIGHT_DIR) {
  console.error('Set PLAYWRIGHT_DIR to a directory containing the playwright package.');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, 'playwright'));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function serveFixtures() {
  const server = http.createServer((request, response) => {
    const requested = path.normalize(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.join(FIXTURES, requested);
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

const stage = (label) => { if (process.env.HARNESS_DEBUG) console.error(`[harness] ${label}`); };
const CDP_TIMEOUT_MS = Number(process.env.CDP_TIMEOUT_MS ?? 30_000);
// A suite must finish or fail; it must never hang. Exit code 3 marks a watchdog stop.
const SUITE_TIMEOUT_MS = Number(process.env.SUITE_TIMEOUT_MS ?? 300_000);

class TargetSession {
  constructor(browserSession, sessionId, targetId) {
    this.browserSession = browserSession;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.nextId = 1;
    this.pending = new Map();
    browserSession.on('Target.receivedMessageFromTarget', (event) => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      // An unexpected dialog would block the popup forever: dismiss it and fail the next call clearly.
      if (message.method === 'Page.javascriptDialogOpening') {
        this.failure = new Error(`Unexpected ${message.params.type} dialog in the popup: "${message.params.message}"`);
        void this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
        for (const [, waiting] of this.pending) waiting.reject(this.failure);
        this.pending.clear();
      }
      if (message.method === 'Inspector.targetCrashed') {
        this.failure = new Error('Browser infrastructure: the popup renderer crashed (not a product assertion).');
        for (const [, waiting] of this.pending) waiting.reject(this.failure);
        this.pending.clear();
      }
      const pending = message.id && this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    if (this.failure && method !== 'Page.handleJavaScriptDialog') return Promise.reject(this.failure);
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} did not answer within ${CDP_TIMEOUT_MS}ms`)); }, CDP_TIMEOUT_MS);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    });
    void this.browserSession.send('Target.sendMessageToTarget', { sessionId: this.sessionId, message: JSON.stringify({ id, method, params }) });
    return result;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  async close() {
    await this.browserSession.send('Target.closeTarget', { targetId: this.targetId });
  }

  async screenshot(path) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.mkdirSync(fileURLToPath(new URL('../../test-results/', import.meta.url)), { recursive: true });
    fs.writeFileSync(path, Buffer.from(result.data, 'base64'));
  }
}

export async function launch({ args = [], contextOptions = {} } = {}) {
  setTimeout(() => { console.error(`[harness] suite exceeded ${SUITE_TIMEOUT_MS}ms; stopping instead of hanging`); process.exit(3); }, SUITE_TIMEOUT_MS).unref();
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) throw new Error('dist/ is missing; run npm run build first');
  stage('launching Chromium');
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'soft-blackout-browser-')), {
    headless: true,
    ...contextOptions,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--enable-unsafe-extension-debugging', ...args],
  });
  context.on('page', (page) => {
    page.on('crash', () => { console.error(`[harness] browser infrastructure: page renderer crashed (${page.url()})`); process.exitCode = 4; });
    page.on('dialog', (dialog) => { console.error(`[harness] unexpected page dialog dismissed: ${dialog.type()} "${dialog.message()}"`); process.exitCode = 1; void dialog.dismiss(); });
  });
  const browserSession = await context.browser().newBrowserCDPSession();
  await browserSession.send('Target.setDiscoverTargets', { discover: true });

  stage('Chromium up; discovering extension id');
  const extensionPage = await context.newPage();
  await extensionPage.goto('chrome://extensions/');
  const extensionId = await extensionPage.evaluate(async () => {
    const findItems = () => {
      const manager = document.querySelector('extensions-manager');
      const list = manager?.shadowRoot?.querySelector('extensions-item-list');
      return [...(list?.shadowRoot?.querySelectorAll('extensions-item') ?? [])];
    };
    for (let attempt = 0; attempt < 100; attempt++) {
      const item = findItems().find((candidate) => candidate.shadowRoot?.textContent?.includes('Soft Blackout'));
      if (item?.id) return item.id;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  });
  stage('extension id found');
  await extensionPage.close();
  if (!extensionId) throw new Error('Soft Blackout extension ID was not discoverable in chrome://extensions');

  const targets = async () => (await browserSession.send('Target.getTargets', { filter: [{}] })).targetInfos;
  return {
    context,
    extensionId,
    async triggerAction(page) {
      const tab = (await targets()).find((target) => target.type === 'tab' && target.url === page.url());
      if (!tab) throw new Error(`No tab target for ${page.url()}`);
      for (let attempt = 0; attempt < 3; attempt++) {
        // Chromium can drop a toolbar click sent while the previous popup is still tearing down, and then
        // never answer it. Wait for the old popup target to disappear, and bound the click itself.
        const popupUrl = `chrome-extension://${extensionId}/popup/index.html`;
        for (let wait = 0; wait < 40 && (await targets()).some((target) => target.url === popupUrl); wait++) await sleep(25);
        stage(`triggerAction attempt ${attempt + 1}`);
        const clicked = await Promise.race([
          browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId }).then(() => true),
          sleep(3000).then(() => false),
        ]);
        if (!clicked) { console.error(`[harness] browser infrastructure: toolbar click ${attempt + 1} was not acknowledged within 3s`); continue; }
        for (let poll = 0; poll < 30; poll++) {
          const popup = (await targets()).find((target) => target.url === `chrome-extension://${extensionId}/popup/index.html`);
          if (popup) {
            const attached = await browserSession.send('Target.attachToTarget', { targetId: popup.targetId, flatten: false });
            const session = new TargetSession(browserSession, attached.sessionId, popup.targetId);
            stage('popup attached');
            await session.send('Page.enable');
            await session.evaluate('new Promise((resolve) => document.readyState === "complete" ? resolve() : addEventListener("load", resolve, { once: true }))');
            await session.evaluate('new Promise((resolve, reject) => { const started=Date.now(); const ready=()=>document.body?.dataset.ready==="true"?resolve():Date.now()-started>3000?reject(new Error("Popup initialization timed out")):setTimeout(ready,20); ready(); })');
            return session;
          }
          await sleep(100);
        }
      }
      throw new Error('Popup did not open from the toolbar action');
    },
    async close() { await context.close(); },
  };
}
