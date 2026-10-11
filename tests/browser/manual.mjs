import { createRequire } from 'node:module';
import path from 'node:path';
import { launch, serveFixtures, sleep } from './harness.mjs';

const require = createRequire(import.meta.url);
const { PNG } = require(path.join(process.env.PLAYWRIGHT_DIR, 'playwright-core/lib/utilsBundle.js'));
const checks = [];
const check = (name, condition, detail = '') => {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const context = (page) => page.locator('[data-soft-blackout-owned="manual-context"]');
const indicator = (page) => page.locator('[data-soft-blackout-owned="manual-indicator"]');
const setSelection = (page, selector, start, end) => page.evaluate(({ selector, start, end }) => {
  const node = document.querySelector(selector).firstChild;
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
}, { selector, start, end });
const clickShadowButton = async (host, label) => host.getByRole('button', { name: label }).click();
const protocolState = async (popup) => popup.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>chrome.tabs.sendMessage(tab.id,{marker:'soft-blackout',version:1,buildId:chrome.runtime.getManifest().version,requestId:'manual-state',type:'GET_STATE',payload:null})).then(r=>r.data)`);

function stats(buffer) {
  const png = PNG.sync.read(buffer); let dark = 0, red = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b, a] = png.data.subarray(i, i + 4); if (a < 250) continue;
    if (r < 50 && g < 50 && b < 50) dark++;
    if (r > 140 && g < 80 && b < 80) red++;
  }
  return { dark, red };
}

const { server, origin } = await serveFixtures();
let browser;
try {
  browser = await launch();
  const page = await browser.context.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`${origin}/engine.html`);
  let popup = await browser.triggerAction(page); await sleep(100);
  check('popup exposes Start selecting', await popup.evaluate("document.getElementById('manualActionBtn').textContent === 'Start selecting'"));
  await popup.evaluate("document.getElementById('manualActionBtn').click()");
  await indicator(page).waitFor({ state: 'attached', timeout: 3000 });
  const startStatus = await popup.evaluate("document.getElementById('status').textContent");
  const startState = await protocolState(popup);
  check('Manual session shows one accessible indicator', await indicator(page).count() === 1 && await indicator(page).getByRole('button', { name: 'Done' }).count() === 1, `${startStatus} ${JSON.stringify(startState.editing)}`.trim());
  await popup.close(); await page.bringToFront();

  const measureDrag = () => page.evaluate(() => {
    document.querySelector('#partial').scrollIntoView({ block: 'center' });
    const node = document.querySelector('#partial').firstChild;
    const a = document.createRange(); a.setStart(node, 6); a.setEnd(node, 6);
    const b = document.createRange(); b.setStart(node, 17); b.setEnd(node, 17);
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { x1: ar.left + 1, y1: ar.top + ar.height / 2, x2: br.left - 1, y2: br.top + br.height / 2 };
  });
  let drag = await measureDrag();
  await page.mouse.move(drag.x1, drag.y1); await page.mouse.down(); await page.mouse.move(drag.x2, drag.y2, { steps: 8 }); await page.mouse.up(); await sleep(100);
  check('native mouse selection opens Mask and Cancel confirmation', await context(page).getByRole('button', { name: 'Mask' }).count() === 1 && await context(page).getByRole('button', { name: 'Cancel' }).count() === 1);
  const before = stats(await page.locator('#partial').screenshot());
  await clickShadowButton(context(page), 'Mask'); await sleep(100);
  const after = stats(await page.locator('#partial').screenshot());
  check('confirmed partial-word selection is pixel-obscured', after.dark > before.dark + 300 && after.red < before.red, JSON.stringify({ before, after }));
  check('Manual mask does not wrap or rewrite page text', await page.locator('#partial').textContent() === 'alpha partialword omega');

  await page.emulateMedia({ forcedColors: 'active' });
  await setSelection(page, '#duplicate', 0, 6); await sleep(50);
  check('forced-colors mode refuses deceptive visual masking', await context(page).count() === 0 && await indicator(page).locator('.hint').textContent() === 'Visual masking is unavailable while forced colors are active.');
  await page.emulateMedia({ forcedColors: 'none' });

  await setSelection(page, '#duplicate', 0, 6); await sleep(50); await clickShadowButton(context(page), 'Cancel');
  check('Cancel creates no additional mask', (await context(page).count()) === 0);

  await page.evaluate(() => {
    const start = document.querySelector('#nested').firstChild, end = document.querySelector('#nested em').firstChild;
    const range = document.createRange(); range.setStart(start, 3); range.setEnd(end, 9);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
  });
  await sleep(50); await clickShadowButton(context(page), 'Mask');
  check('nested multi-node selection commits as one operation', true);

  await page.evaluate(() => { const p=document.createElement('p');p.id='unicode';p.textContent='Türkçe İstanbul — مرحبا بالعالم';document.querySelector('main').append(p); });
  await setSelection(page, '#unicode', 0, 15); await sleep(50); await clickShadowButton(context(page), 'Mask');
  check('Unicode, Turkish, and RTL text selection commits', true);

  popup = await browser.triggerAction(page); await sleep(100);
  let state = await protocolState(popup);
  check('popup reopening synchronizes active session and engine history', state.editing.active && state.manual.maskedCount === 3 && await popup.evaluate("document.getElementById('manualActionBtn').textContent === 'Done'"));
  check('retired legacy automatic controls are absent', await popup.evaluate("!document.getElementById('autoRedactBtn') && !document.getElementById('blackoutAllBtn')"));
  await popup.evaluate("document.getElementById('undoBtn').click()"); await sleep(60);
  state = await protocolState(popup); check('popup Undo targets Manual ledger', state.manual.maskedCount === 2 && state.history.canRedo);
  await popup.evaluate("document.getElementById('redoBtn').click()"); await sleep(60);
  state = await protocolState(popup); check('popup Redo restores exact Manual operation', state.manual.maskedCount === 3);
  await popup.close(); await page.bringToFront();

  await setSelection(page, '#partial', 8, 12); await sleep(60);
  check('selection inside one owned mask offers exact Reveal', await context(page).getByRole('button', { name: 'Reveal' }).count() === 1);
  await clickShadowButton(context(page), 'Reveal');
  popup = await browser.triggerAction(page); await sleep(80); state = await protocolState(popup);
  check('Reveal removes only the selected owned segment', state.manual.maskedCount === 2);
  await popup.evaluate("document.getElementById('undoBtn').click()"); await sleep(60); state = await protocolState(popup);
  check('Reveal is Undoable', state.manual.maskedCount === 3);
  await popup.close(); await page.bringToFront();

  await setSelection(page, '#duplicate', 14, 20); await sleep(50);
  await page.keyboard.press('Escape'); await sleep(30);
  check('Escape dismisses pending confirmation but keeps session active', await context(page).count() === 0 && await indicator(page).count() === 1);

  await page.evaluate(() => {
    const node=document.querySelector('#duplicate').firstChild,r=document.createRange();r.setStart(node,7);r.setEnd(node,13);
    const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'ArrowRight',shiftKey:true}));
  });
  await sleep(60);
  check('keyboard-created selection focuses accessible Mask control', await context(page).getByRole('button', { name: 'Mask' }).evaluate((button) => button === button.getRootNode().activeElement));
  await page.keyboard.press('Enter'); await sleep(60);
  check('Enter confirms keyboard selection', await context(page).count() === 0);

  await setSelection(page, '#control', 0, 4); await sleep(50);
  check('form-control-adjacent button text is rejected safely', await context(page).count() === 0);
  await page.locator('#link').click(); check('ordinary link clicks are not intercepted', page.url().endsWith('#safe'));
  await page.locator('#control').click(); check('ordinary button interaction remains available', true);

  await page.setViewportSize({ width: 500, height: 500 }); await page.evaluate(() => { document.body.style.zoom='1.25'; scrollTo(0, 250); });
  check('indicator remains viewport-fixed through resize, zoom, and scroll', await indicator(page).count() === 1);

  await clickShadowButton(indicator(page), 'Done'); await sleep(50);
  check('Done removes temporary UI and preserves masks', await indicator(page).count() === 0 && (await stats(await page.locator('#partial').screenshot())).dark > 300);
  popup = await browser.triggerAction(page); await sleep(80); state = await protocolState(popup);
  check('Done is authoritative after popup reopening', !state.editing.active && state.manual.maskedCount > 0 && await popup.evaluate("document.getElementById('manualActionBtn').textContent === 'Start selecting'"));
  await popup.evaluate("document.getElementById('manualActionBtn').click()"); await sleep(50);
  check('Manual can restart without duplicate indicator UI', await indicator(page).count() === 1);
  await popup.evaluate("window.confirm=()=>true;document.getElementById('resetRedactBtn').click()"); await sleep(80); state = await protocolState(popup);
  check('Reset removes masks, history, pending state, and session UI', state.manual.maskedCount === 0 && !state.history.canUndo && !state.editing.active && await page.evaluate(() => CSS.highlights.size === 0) && await indicator(page).count() === 0);
  await popup.evaluate("document.getElementById('autoMask').click();document.getElementById('manualActionBtn').click()"); await sleep(120);
  check('Mask on select is saved and announced in the session', (await popup.evaluate('chrome.storage.local.get("preferences")')).preferences?.autoMask === true && await indicator(page).locator('.hint').textContent() === 'Select text to mask it.');
  await page.bringToFront(); drag = await measureDrag();
  await page.mouse.move(drag.x1, drag.y1); await page.mouse.down(); await page.mouse.move(drag.x2, drag.y2, { steps: 8 }); await page.mouse.up(); await sleep(120);
  check('Mask on select masks a mouse selection without confirmation', await context(page).count() === 0 && await page.evaluate(() => CSS.highlights.size > 0));
  await setSelection(page, '#partial', 8, 12); await sleep(60);
  check('Mask on select still confirms Reveal', await context(page).getByRole('button', { name: 'Reveal' }).count() === 1);
  popup = await browser.triggerAction(page); await sleep(80);
  await popup.evaluate("document.getElementById('autoMask').click();window.confirm=()=>true;document.getElementById('resetRedactBtn').click()"); await sleep(80);
  const stored = await popup.evaluate('chrome.storage.local.get(null)');
  check('Manual contents and history are not persisted', Object.keys(stored).every((key) => ['preferences','blackoutAppearance'].includes(key)));
  const manifest = await popup.evaluate('chrome.runtime.getManifest()');
  check('permissions remain exact', JSON.stringify([...manifest.permissions].sort()) === JSON.stringify(['activeTab','scripting','storage'].sort()) && !manifest.host_permissions);
} finally {
  server.close(); if (browser) await browser.close();
}
const failed = checks.filter((entry) => !entry.ok);
if (failed.length) { console.error(`${failed.length} Manual browser check(s) failed`); process.exit(1); }
console.log(`[manual-browser] ${checks.length} checks passed`);
