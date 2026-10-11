import { createRequire } from 'node:module';
import path from 'node:path';
import { launch, serveFixtures, sleep } from './harness.mjs';

const require = createRequire(import.meta.url);
const { PNG } = require(path.join(process.env.PLAYWRIGHT_DIR, 'playwright-core/lib/utilsBundle.js'));
const checks = [];
const check = (name, condition, detail = '') => { checks.push({ name, ok: Boolean(condition), detail }); console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const context = (page) => page.locator('[data-soft-blackout-owned="manual-context"]');
const indicator = (page) => page.locator('[data-soft-blackout-owned="manual-indicator"]');
const select = async (page, selector, start, end, keyboard = false) => page.evaluate(({ selector, start, end, keyboard }) => {
  const node = document.querySelector(selector).firstChild, range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(keyboard ? new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight', shiftKey: true }) : new PointerEvent('pointerup', { bubbles: true, button: 0 }));
}, { selector, start, end, keyboard });
const state = (popup, id = `poetry-${Date.now()}`) => popup.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>chrome.tabs.sendMessage(tab.id,{marker:'soft-blackout',version:1,buildId:chrome.runtime.getManifest().version,requestId:${JSON.stringify(id)},type:'GET_STATE',payload:null})).then(r=>r.data)`);
const pixels = (buffer) => { const png=PNG.sync.read(buffer);let dark=0,red=0;for(let i=0;i<png.data.length;i+=4){const [r,g,b,a]=png.data.subarray(i,i+4);if(a<250)continue;if(r<50&&g<50&&b<50)dark++;if(r>140&&g<90&&b<90)red++;}return{dark,red}; };

const { server, origin } = await serveFixtures(); let browser;
try {
  browser = await launch(); const page = await browser.context.newPage({ viewport: { width: 900, height: 700 } }); await page.goto(`${origin}/engine.html`);
  let popup = await browser.triggerAction(page); await sleep(100);
  check('popup exposes user-directed Poetry', await popup.evaluate("document.getElementById('poetryActionBtn').textContent === 'Start composing' && ![...document.querySelectorAll('.mode-btn')].some(b=>b.textContent==='Poetry')"));
  await popup.evaluate("document.getElementById('poetryActionBtn').click()"); await sleep(70);
  check('Start composing creates compact Poetry indicator', await indicator(page).getByText('Poetry composition active').count() === 1);
  await popup.close(); await page.bringToFront();

  await select(page, '#partial', 6, 17); await sleep(50);
  check('native selection offers Keep and Cancel', await context(page).getByRole('button', { name: 'Keep' }).count() === 1 && await context(page).getByRole('button', { name: 'Cancel' }).count() === 1);
  await context(page).getByRole('button', { name: 'Keep' }).click(); await sleep(40);
  check('Keep creates non-destructive preview only', await page.evaluate(() => CSS.highlights.has('soft-blackout-poetry-preview')));

  await select(page, '#duplicate', 0, 6); await sleep(40); await context(page).getByRole('button', { name: 'Cancel' }).click();
  popup = await browser.triggerAction(page); await sleep(70); let current = await state(popup);
  check('Cancel does not add a kept selection', current.poetry.keptCount === 1 && current.poetry.blockCount === 1);
  check('popup reopening preserves draft and reports counts', await popup.evaluate("document.getElementById('poetryStats').textContent === '1 kept · 1 block'"));
  await popup.close(); await page.bringToFront();

  await select(page, '#partial', 8, 12); await sleep(40);
  check('selection inside one preview offers Remove from poem', await context(page).getByRole('button', { name: 'Remove from poem' }).count() === 1);
  await context(page).getByRole('button', { name: 'Remove from poem' }).click();
  popup = await browser.triggerAction(page); await sleep(60); current = await state(popup); check('exact pending removal updates draft', current.poetry.keptCount === 0);
  await popup.close(); await page.bringToFront();

  await select(page, '#partial', 6, 17); await sleep(35); await context(page).getByRole('button', { name: 'Keep' }).click();
  await select(page, '#duplicate', 14, 20, true); await sleep(35);
  check('keyboard selection focuses Keep', await context(page).getByRole('button', { name: 'Keep' }).evaluate((button) => button === button.getRootNode().activeElement));
  await page.keyboard.press('Enter');
  popup = await browser.triggerAction(page); await sleep(60); current = await state(popup);
  check('multiple keeps across blocks accumulate', current.poetry.keptCount === 2 && current.poetry.blockCount === 2);
  await popup.evaluate("document.getElementById('clearPoetryBtn').click()"); await sleep(40); current = await state(popup);
  check('Clear removes all previews without committed masks', current.poetry.keptCount === 0 && await page.evaluate(() => !CSS.highlights.has('soft-blackout-poetry-preview')));
  await popup.close(); await page.bringToFront();

  await select(page, '#partial', 6, 17); await sleep(30); await context(page).getByRole('button', { name: 'Keep' }).click();
  await select(page, '#duplicate', 0, 6); await sleep(30); await context(page).getByRole('button', { name: 'Keep' }).click();
  popup = await browser.triggerAction(page); await sleep(50); await popup.evaluate("document.getElementById('applyPoetryBtn').click()"); await sleep(80); current = await state(popup);
  check('Apply commits multi-block composition as one history command', current.poetry.keptCount === 0 && current.poetry.compositionCount === 1 && current.history.undoCount === 1);
  const unaffectedMasked = await page.evaluate(() => [...CSS.highlights].filter(([name]) => name.startsWith('soft-blackout-v2-solid')).some(([, highlight]) => [...highlight].some((range) => range.intersectsNode(document.querySelector('#dark')))));
  check('Apply removes preview and masks only affected blocks', !await page.evaluate(() => CSS.highlights.has('soft-blackout-poetry-preview')) && !unaffectedMasked && current.manual.maskedCount === 0);
  const rendered = pixels(await page.locator('#partial').screenshot());
  check('committed complement has opaque pixels while kept word remains visible', rendered.dark > 1000 && rendered.red > 100, JSON.stringify(rendered));
  check('source layout and text remain unchanged', await page.locator('#partial').textContent() === 'alpha partialword omega');

  await popup.evaluate("document.getElementById('editPoetryBtn').click()"); await sleep(60); current = await state(popup);
  check('Edit composition restores exact kept previews', current.poetry.editing && current.poetry.keptCount === 2 && await page.evaluate(() => CSS.highlights.has('soft-blackout-poetry-preview')));
  await popup.close(); await page.bringToFront();
  await select(page, '#partial', 0, 5); await sleep(35); await context(page).getByRole('button', { name: 'Keep' }).click();
  popup = await browser.triggerAction(page); await sleep(50); await popup.evaluate("document.getElementById('cancelPoetryEditBtn').click()"); await sleep(50); current = await state(popup);
  check('Cancel edit leaves applied composition unchanged', !current.poetry.editing && current.history.undoCount === 1);
  await popup.evaluate("document.getElementById('editPoetryBtn').click()"); await popup.close(); await page.bringToFront();
  await select(page, '#partial', 0, 5); await sleep(35); await context(page).getByRole('button', { name: 'Keep' }).click();
  popup = await browser.triggerAction(page); await sleep(50); await popup.evaluate("document.getElementById('applyPoetryBtn').click()"); await sleep(60); current = await state(popup);
  check('Reapply records one composition revision', current.history.undoCount === 2 && current.poetry.compositionCount === 1);
  await popup.evaluate("document.getElementById('undoBtn').click()"); await sleep(40); const undoState = await state(popup);
  await popup.evaluate("document.getElementById('redoBtn').click()"); await sleep(40); const redoState = await state(popup);
  check('Undo and Redo traverse the revision atomically', undoState.history.canRedo && redoState.history.canRedo === false);

  // Wait for Manual to actually start before closing: closing mid-request would drop START_EDITING.
  await popup.evaluate("(async()=>{const b=document.getElementById('manualActionBtn');b.click();const t=Date.now();while(b.textContent!=='Done'){if(Date.now()-t>5000)throw new Error('Manual did not start');await new Promise(r=>setTimeout(r,10))}})()"); await popup.close(); await page.bringToFront();
  await select(page, '#large', 0, 5); await sleep(35); await context(page).getByRole('button', { name: 'Mask' }).click();
  popup = await browser.triggerAction(page); await sleep(50); current = await state(popup);
  check('Manual and Poetry operations coexist in unified history', current.manual.maskedCount === 1 && current.poetry.compositionCount === 1 && current.history.undoCount === 3);

  await popup.evaluate("window.confirm=()=>true;document.getElementById('resetRedactBtn').click()"); await sleep(50);
  await page.emulateMedia({ forcedColors: 'active' });
  await popup.evaluate("document.getElementById('poetryActionBtn').click()");
  await sleep(50); const forcedStatus = await popup.evaluate("document.getElementById('status').textContent");
  check('forced-colors mode refuses Poetry masking', forcedStatus.includes('unavailable'));
  await page.emulateMedia({ forcedColors: 'none' });

  const stored = await popup.evaluate('chrome.storage.local.get(null)'); const manifest = await popup.evaluate('chrome.runtime.getManifest()');
  check('Poetry content is not persisted', Object.keys(stored).every((key) => ['preferences','blackoutAppearance'].includes(key)));
  check('permissions remain exact', JSON.stringify([...manifest.permissions].sort()) === JSON.stringify(['activeTab','scripting','storage'].sort()) && !manifest.host_permissions);
} finally { server.close(); if (browser) await browser.close(); }
const failed = checks.filter((entry) => !entry.ok); if (failed.length) { console.error(`${failed.length} Poetry browser check(s) failed`); process.exit(1); }
console.log(`[poetry-browser] ${checks.length} checks passed`);
