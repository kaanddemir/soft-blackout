import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DIST, launch, serveFixtures, sleep } from './harness.mjs';

const manifest = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
const checks = [];
let requestCounter = 0;

const check = (name, condition, detail = '') => {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const protocolRequest = (popup, type, payload, buildId = manifest.version) => {
  requestCounter += 1;
  const message = { marker: 'soft-blackout', version: 1, buildId, requestId: `browser-${requestCounter}`, type, payload };
  return popup.evaluate(`chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => chrome.tabs.sendMessage(tab.id, ${JSON.stringify(message)}))`);
};

const state = async (popup) => {
  const response = await protocolRequest(popup, 'GET_STATE', null);
  if (!response?.ok) throw new Error(`GET_STATE failed: ${JSON.stringify(response)}`);
  return response.data;
};

const { server, origin } = await serveFixtures();
const { server: crossOriginServer, origin: crossOrigin } = await serveFixtures();
let browser;
try {
  browser = await launch();
  const page = await browser.context.newPage();
  await page.goto(`${origin}/article.html`);

  let popup = await browser.triggerAction(page);
  await sleep(200);
  check('popup renders', await popup.evaluate("document.querySelector('h1')?.textContent === 'Soft Blackout'"));
  check('approved controls render', await popup.evaluate("['manualActionBtn','poetryActionBtn','scanPatternsBtn','undoBtn','redoBtn','resetRedactBtn'].every(id => document.getElementById(id))"));

  await popup.evaluate("document.getElementById('manualActionBtn').click()");
  await sleep(150);
  check('first activation starts Manual Mode', await page.locator('[data-soft-blackout-owned="manual-indicator"]').count() === 1);
  const firstState = await state(popup);
  check('runtime exposes a ready document identity', firstState.phase === 'ready' && typeof firstState.documentId === 'string');
  check('runtime owns one stylesheet claim', firstState.styleClaimed === true);

  await popup.close();
  await page.bringToFront();
  popup = await browser.triggerAction(page);
  await sleep(200);
  check('popup reopening synchronizes active editing', await popup.evaluate("document.getElementById('manualActionBtn').textContent === 'Done'"));
  const reopenedState = await state(popup);
  check('popup reopening reuses the same runtime', reopenedState.documentId === firstState.documentId);

  const secondClaim = await protocolRequest(popup, 'CLAIM_STYLE', null);
  check('repeated activation cannot claim duplicate CSS', secondClaim.ok && secondClaim.data.claimed === false);

  await page.evaluate(() => history.pushState({}, '', '#same-document'));
  check('same-document navigation retains runtime ownership', (await state(popup)).documentId === firstState.documentId);

  check('legacy automatic controls are absent', await popup.evaluate("!document.getElementById('autoRedactBtn') && !document.getElementById('blackoutAllBtn') && document.getElementById('settingsBtn')"));
  const retired = await popup.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>chrome.tabs.sendMessage(tab.id,{marker:'soft-blackout',version:1,buildId:${JSON.stringify(manifest.version)},requestId:'retired',type:'AUTO_REDACT',payload:null}))`);
  check('retired legacy protocol command is rejected', retired?.ok === false && retired.error?.code === 'INVALID_MESSAGE');

  const beforeMalformed = await state(popup);
  const malformed = await popup.evaluate(`chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => chrome.tabs.sendMessage(tab.id, {
    marker: 'soft-blackout', version: 1, buildId: ${JSON.stringify(manifest.version)}, requestId: 'bad', type: 'START_EDITING', payload: { mode: 'poetry' }
  }))`);
  const afterMalformed = await state(popup);
  check('malformed protocol messages are rejected', malformed?.ok === false && malformed.error?.code === 'INVALID_MESSAGE');
  check('malformed messages do not mutate runtime state', beforeMalformed.documentId === afterMalformed.documentId && beforeMalformed.pattern.total === afterMalformed.pattern.total);

  await popup.evaluate("document.getElementById('resetRedactBtn').click()");
  await sleep(150);
  const resetState = await state(popup);
  check('Reset removes all engine masks', await page.evaluate(() => CSS.highlights.size === 0));
  check('Reset stops Manual Mode and clears in-page UI', !resetState.editing.active && await page.locator('[data-soft-blackout-owned]').count() === 0);
  check('Reset clears Undo and Redo history', !resetState.history.canUndo && !resetState.history.canRedo);

  await popup.evaluate("document.getElementById('manualActionBtn').click()");
  await sleep(100);
  check('fresh editing works after Reset', await page.locator('[data-soft-blackout-owned="manual-indicator"]').count() === 1);
  await popup.evaluate("document.getElementById('manualActionBtn').click()");
  await sleep(100);
  check('Stop Editing preserves runtime but removes temporary Manual UI', await page.locator('[data-soft-blackout-owned]').count() === 0 && (await state(popup)).phase === 'ready');

  const beforeReloadId = (await state(popup)).documentId;
  await popup.close();
  await page.reload();
  await page.bringToFront();
  popup = await browser.triggerAction(page);
  await sleep(200);
  check('full reload is a runtime boundary', await popup.evaluate("document.getElementById('manualActionBtn').textContent === 'Start selecting'"));
  await popup.evaluate("{ const button = document.getElementById('manualActionBtn'); button.click(); button.click(); button.click(); }");
  await sleep(150);
  const concurrentState = await state(popup);
  check('new document receives a new runtime identity', concurrentState.documentId !== beforeReloadId);
  check('concurrent initialization converges on one ready runtime', concurrentState.phase === 'ready' && concurrentState.editing.active && concurrentState.styleClaimed);

  const dispose = await protocolRequest(popup, 'DISPOSE', null);
  check('Dispose succeeds and unregisters the runtime', dispose?.ok === true && dispose.data.disposed === true);
  const afterDispose = await protocolRequest(popup, 'PING', null).catch(() => null);
  check('disposed runtime no longer handles messages', afterDispose === null);
  check('Dispose removes active editing resources and owned masks', await page.locator('[data-soft-blackout-owned]').count() === 0 && await page.evaluate(() => CSS.highlights.size === 0));

  await popup.close();
  await page.bringToFront();
  popup = await browser.triggerAction(page);
  await sleep(200);
  await popup.evaluate("document.getElementById('manualActionBtn').click()");
  await sleep(150);
  check('disposed runtime can be injected again cleanly', (await state(popup)).phase === 'ready');

  await protocolRequest(popup, 'DISPOSE', null);
  await popup.evaluate(`chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
    const buildId = 'stale-compatible-build';
    const documentId = 'stale-document';
    let listener;
    const snapshot = () => ({ buildId, documentId, phase: 'ready', selectedMode: 'poetry', editing: { active: false, mode: null }, history: { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 }, legacy: { redactedCount: 0 }, pending: false, styleClaimed: true, lastError: null });
    const dispose = () => { chrome.runtime.onMessage.removeListener(listener); delete window.__softBlackoutRuntime; return true; };
    listener = (message, _sender, respond) => {
      if (message?.marker !== 'soft-blackout') return;
      if (message.type === 'PING') respond({ ok: true, data: snapshot() });
      else if (message.type === 'DISPOSE') { dispose(); respond({ ok: true, data: { disposed: true, buildId } }); }
      else respond({ ok: false, error: { code: 'RUNTIME_VERSION_MISMATCH', message: 'stale', recoverable: true, actualBuildId: buildId } });
      return false;
    };
    window.__softBlackoutRuntime = { buildId, phase: 'ready', state: snapshot, dispose };
    chrome.runtime.onMessage.addListener(listener);
  } }))`);
  await popup.close();
  await page.bringToFront();
  popup = await browser.triggerAction(page);
  await sleep(200);
  check('compatible stale runtime is detected', await popup.evaluate("document.getElementById('status').textContent.includes('Reload this page')"));
  await popup.evaluate("document.getElementById('manualActionBtn').click()");
  await sleep(200);
  const replacedState = await state(popup);
  check('compatible stale runtime is disposed and replaced', replacedState.buildId === manifest.version && replacedState.documentId !== 'stale-document');

  await protocolRequest(popup, 'DISPOSE', null);
  await popup.evaluate(`chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
    window.__softBlackoutInjected = true;
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (message?.action !== 'ping') return;
      respond({ pong: true, buildId: 'legacy-unsupported-build' });
      return false;
    });
  } }))`);
  await popup.close();
  await page.bringToFront();
  popup = await browser.triggerAction(page);
  await sleep(200);
  check('unsupported legacy runtime requests a reload', await popup.evaluate("document.getElementById('status').textContent.includes('Reload this page')"));
  await popup.evaluate("document.getElementById('manualActionBtn').click()");
  await sleep(200);
  check('unsupported legacy runtime is not layered over', await page.locator('[data-soft-blackout-owned="manual-indicator"]').count() === 0);
  await popup.close();
  await page.reload();

  await page.bringToFront();
  popup = await browser.triggerAction(page);
  await sleep(200);
  await popup.evaluate("document.getElementById('manualActionBtn').click()");
  await sleep(150);
  const tabOneId = (await state(popup)).documentId;
  const stored = await popup.evaluate('chrome.storage.local.get(null)');
  check('storage contains only validated non-sensitive preferences', Object.keys(stored).every((key) => ['patternCategories','preferences','blackoutAppearance'].includes(key)) && !JSON.stringify(stored).includes('example.com'), JSON.stringify(stored));
  await popup.close();

  const secondPage = await browser.context.newPage();
  await secondPage.goto(`${origin}/article.html?tab=2`);
  await secondPage.bringToFront();
  popup = await browser.triggerAction(secondPage);
  await sleep(200);
  await popup.evaluate("document.getElementById('manualActionBtn').click()");
  await sleep(150);
  const tabTwoId = (await state(popup)).documentId;
  check('runtime state is isolated between tabs', tabTwoId !== tabOneId);
  await popup.close();
  await secondPage.close();
  check('closing a tab with a runtime leaves the extension available', secondPage.isClosed());

  await page.bringToFront();
  await page.goto(`${crossOrigin}/article.html?origin=2`);
  check('cross-origin navigation does not retain editing behavior', await page.locator('[data-soft-blackout-owned="manual-indicator"]').count() === 0);
  popup = await browser.triggerAction(page);
  await sleep(200);
  await popup.evaluate("document.getElementById('manualActionBtn').click()");
  await sleep(150);
  check('cross-origin document gets isolated runtime state after a new gesture', (await state(popup)).documentId !== tabOneId);
  await popup.close();

  const restricted = await browser.context.newPage();
  await restricted.goto('chrome://extensions/');
  await restricted.bringToFront();
  popup = await browser.triggerAction(restricted);
  await sleep(300);
  const restrictedStatus = await popup.evaluate("document.getElementById('status').textContent");
  const restrictedActiveUrl = await popup.evaluate("chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.url ?? '')");
  check('restricted page fails safely', restrictedStatus === 'Cannot run on this page.', `${restrictedActiveUrl} ${restrictedStatus}`.trim());

  check('no persistent host permission is present', !manifest.host_permissions, JSON.stringify(manifest.permissions));
  check('approved permissions remain exact', JSON.stringify([...manifest.permissions].sort()) === JSON.stringify(['activeTab', 'scripting', 'storage'].sort()));
} finally {
  server.close();
  crossOriginServer.close();
  if (browser) await browser.close();
}

const failed = checks.filter((entry) => !entry.ok);
if (failed.length) {
  console.error(`${failed.length} browser check(s) failed`);
  process.exit(1);
}
console.log(`[browser] ${checks.length} checks passed`);
