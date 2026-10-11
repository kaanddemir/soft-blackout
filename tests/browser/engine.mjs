import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serveFixtures, sleep } from './harness.mjs';

const require = createRequire(import.meta.url);
const playwrightRoot = process.env.PLAYWRIGHT_DIR;
const { PNG } = require(path.join(playwrightRoot, 'playwright-core/lib/utilsBundle.js'));
const checks = [];
const check = (name, condition, detail = '') => {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const execute = (popup, body) => popup.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>chrome.scripting.executeScript({target:{tabId:tab.id},func:${body}}).then(([result])=>result.result))`);
const selectAndCommit = (popup, selector, start, end, options = '{}') => execute(popup, `() => {
  const node = document.querySelector(${JSON.stringify(selector)}).firstChild;
  const range = document.createRange(); range.setStart(node, ${start}); range.setEnd(node, ${end});
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  const result = window.__softBlackoutRuntime.engine.commitSelection(...Object.values(${options}));
  selection.removeAllRanges(); return result;
}`);
const engineState = (popup) => execute(popup, `() => window.__softBlackoutRuntime.engine.state()`);

function colorStats(buffer) {
  const png = PNG.sync.read(buffer); let black = 0, red = 0, opaque = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b, a] = png.data.subarray(i, i + 4); if (a < 250) continue; opaque++;
    if (r < 50 && g < 50 && b < 50) black++;
    if (r > 140 && g < 80 && b < 80) red++;
  }
  return { black, red, opaque };
}

const { server, origin } = await serveFixtures();
let browser;
try {
  browser = await launch();
  const page = await browser.context.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`${origin}/engine.html`);
  let popup = await browser.triggerAction(page); await sleep(150);
  await popup.evaluate("document.getElementById('manualActionBtn').click()"); await sleep(100);

  const before = colorStats(await page.locator('#partial').screenshot());
  const partial = await selectAndCommit(popup, '#partial', 6, 17);
  const after = colorStats(await page.locator('#partial').screenshot());
  check('partial-word range commits without DOM wrapping', partial.ok && await page.locator('#partial').textContent() === 'alpha partialword omega');
  check('rendered pixels replace colored glyphs with opaque ink', after.black > before.black + 500 && after.red < before.red, JSON.stringify({ before, after }));
  check('source text remains in the DOM', await page.locator('#partial').textContent() === 'alpha partialword omega');

  const firstDuplicate = await selectAndCommit(popup, '#duplicate', 0, 6);
  const secondDuplicate = await selectAndCommit(popup, '#duplicate', 14, 20);
  check('duplicate strings are independently owned', firstDuplicate.ok && secondDuplicate.ok && (await engineState(popup)).activeSegments === 3);
  await execute(popup, `() => window.__softBlackoutRuntime.engine.undo()`);
  check('engine Undo removes only the latest operation', (await engineState(popup)).activeSegments === 2);
  await execute(popup, `() => window.__softBlackoutRuntime.engine.redo()`);
  check('engine Redo restores the exact operation', (await engineState(popup)).activeSegments === 3);

  const inspection = await execute(popup, `() => window.__softBlackoutRuntime.engine.inspect(${JSON.stringify(firstDuplicate.operationId)})`);
  await execute(popup, `() => window.__softBlackoutRuntime.engine.reveal(${JSON.stringify(firstDuplicate.operationId)}, ${JSON.stringify(inspection.segmentIds[0])})`);
  check('individual Reveal preserves unrelated masks', (await engineState(popup)).activeSegments === 2);
  await execute(popup, `() => window.__softBlackoutRuntime.engine.undo()`);
  check('individual Reveal is reversible', (await engineState(popup)).activeSegments === 3);

  const nested = await execute(popup, `() => {
    const a=document.querySelector('#nested').firstChild,b=document.querySelector('#nested em').firstChild;
    const r=document.createRange();r.setStart(a,3);r.setEnd(b,9);const s=getSelection();s.addRange(r);
    const out=window.__softBlackoutRuntime.engine.commitSelection();s.removeAllRanges();return out;
  }`);
  check('multi-node nested inline range commits', nested.ok);

  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.setViewportSize({ width: 500, height: 500 });
  await page.evaluate(() => { document.body.style.zoom = '1.25'; });
  check('masks survive scrolling, zoom, and responsive reflow', (await engineState(popup)).activeSegments === 4);

  const shadow = await execute(popup, `() => {
    const n=document.querySelector('#shadow-host').shadowRoot.querySelector('#shadow-text').firstChild;
    const r=document.createRange();r.setStart(n,5);r.setEnd(n,11);const s=getSelection();s.addRange(r);
    const out=window.__softBlackoutRuntime.engine.commitSelection();s.removeAllRanges();return out;
  }`);
  check('open shadow-root range is supported', shadow.ok);
  check('closed shadow roots and frames are not traversed by the adapter', await page.evaluate(() => document.querySelector('#closed-host').shadowRoot === null && Boolean(document.querySelector('#frame').contentDocument)));

  await page.evaluate(() => { const node = document.querySelector('#nested'); node.replaceWith(node.cloneNode(true)); });
  await execute(popup, `() => window.__softBlackoutRuntime.engine.updateAppearance(${JSON.stringify(nested.operationId)}, {style:'solid',color:'#65786c'})`);
  check('detached ranges invalidate without text rematching', (await engineState(popup)).invalidatedSegments > 0);

  await execute(popup, `() => window.__softBlackoutRuntime.engine.reset()`);
  check('engine Reset is idempotent and clears registrations', (await engineState(popup)).activeSegments === 0 && await execute(popup, `() => { window.__softBlackoutRuntime.engine.reset(); return CSS.highlights.size; }`) === 0);
  const storage = await popup.evaluate('chrome.storage.local.get(null)');
  check('engine stores no source text or history', Object.keys(storage).every((key) => ['preferences','blackoutAppearance'].includes(key)) && !JSON.stringify(storage).includes('partialword'));

  const perf = await execute(popup, `() => {
    const p=document.createElement('p');p.id='perf';p.textContent='word '.repeat(20000);document.body.append(p);
    const n=p.firstChild,ranges=[];for(let i=0;i<200;i++){const r=document.createRange();r.setStart(n,i*5);r.setEnd(n,i*5+4);ranges.push(r)}
    const start=performance.now();const result=window.__softBlackoutRuntime.engine.commitRanges(ranges);
    return {ms:performance.now()-start,result};
  }`);
  check('200-range large-document operation stays bounded', perf.result.ok && perf.result.state.activeSegments === 200 && perf.ms < 500, `${perf.ms.toFixed(1)}ms`);
  await execute(popup, `() => { window.__softBlackoutRuntime.engine.reset(); return true; }`);

  const styleCount = await execute(popup, `() => document.querySelectorAll('[data-soft-blackout-owned="engine-styles"]').length`);
  check('renderer does not duplicate root style ownership', styleCount <= 1, String(styleCount));
  await popup.close(); await page.bringToFront(); popup = await browser.triggerAction(page); await sleep(100);
  const dispose = await popup.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>chrome.tabs.sendMessage(tab.id,{marker:'soft-blackout',version:1,buildId:chrome.runtime.getManifest().version,requestId:'engine-dispose',type:'DISPOSE',payload:null}))`);
  check('Dispose removes engine highlights and styles', dispose.ok && await page.evaluate(() => CSS.highlights.size === 0 && !document.querySelector('[data-soft-blackout-owned="engine-styles"]')));
} finally {
  server.close(); if (browser) await browser.close();
}
const failed = checks.filter((entry) => !entry.ok);
if (failed.length) { console.error(`${failed.length} engine browser check(s) failed`); process.exit(1); }
console.log(`[engine-browser] ${checks.length} checks passed`);
