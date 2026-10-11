// Performance and memory in real Chromium on generated documents of increasing size.
// Timings are machine-specific observations; only the coarse reference budgets below are asserted, and the
// documented safety limits (text nodes / characters / ranges) must refuse rather than block the page.
import { launch, serveFixtures, sleep } from './harness.mjs';

const BUDGET = { interactiveMs: 50, scan5kMs: 200, activationMs: 400 };
const checks = [];
const check = (name, value, detail = '') => { checks.push({ name, ok: Boolean(value) }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const send = (popup, type, payload = null) => popup.evaluate(`(async()=>{const t=performance.now();const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const r=await chrome.tabs.sendMessage(tab.id,{marker:'soft-blackout',version:1,buildId:chrome.runtime.getManifest().version,requestId:'perf-'+Math.random(),type:${JSON.stringify(type)},payload:${JSON.stringify(payload)}});return{...r,ms:performance.now()-t}})()`);
const execute = (popup, body, args = []) => popup.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>chrome.scripting.executeScript({target:{tabId:tab.id},func:${body},args:${JSON.stringify(args)}}).then(([r])=>r.result))`);
const fmt = (ms) => `${ms.toFixed(1)}ms`;

// Builds `paragraphs` blocks of three text nodes (text, <em>, text); every 25th carries an email address.
const build = (page, paragraphs, filler) => page.evaluate(({ paragraphs, filler }) => {
  const main = document.querySelector('main'); main.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < paragraphs; i++) {
    const p = document.createElement('p'); p.id = `p${i}`;
    p.append(`Paragraph ${i} ${filler} `, Object.assign(document.createElement('em'), { textContent: `emphasis ${i}` }), i % 25 === 0 ? ` reach person${i}@example.com today.` : ' closing words.');
    fragment.append(p);
  }
  main.append(fragment);
  window.__longTasks = []; new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(entry.duration); }).observe({ type: 'longtask' });
  return { textNodes: paragraphs * 3, characters: main.textContent.length };
}, { paragraphs, filler });
const heap = async (cdp) => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576; };

const { server, origin } = await serveFixtures(); let browser; const rows = [];
try {
  browser = await launch();
  for (const [label, paragraphs, filler] of [['1k nodes', 334, 'with a modest sentence'], ['5k nodes', 1667, 'with a modest sentence'], ['10k nodes', 3334, 'with a modest sentence'], ['~500k chars', 2000, 'lorem ipsum '.repeat(19)]]) {
    const page = await browser.context.newPage({ viewport: { width: 1000, height: 760 } }); await page.goto(`${origin}/engine.html`);
    const size = await build(page, paragraphs, filler);
    const cdp = await page.context().newCDPSession(page); const heapBefore = await heap(cdp);
    let popup = await browser.triggerAction(page);
    // Activation = real popup action → injection → runtime ready → Manual started.
    const activation = { ms: await popup.evaluate("(async()=>{const t=performance.now();manualActionBtn.click();while(manualActionBtn.textContent!=='Done')await new Promise(r=>setTimeout(r,2));return performance.now()-t})()") }; await send(popup, 'STOP_EDITING');
    const commitOne = await execute(popup, `() => { const n = document.getElementById('p1').firstChild, r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 9); const t = performance.now(); const ok = window.__softBlackoutRuntime.engine.commitRanges([r]).ok; return { ok, ms: performance.now() - t }; }`);
    const commitMany = await execute(popup, `() => { const ranges = []; for (let i = 2; i < 402 && document.getElementById('p' + i); i++) { const n = document.getElementById('p' + i).firstChild, r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 9); ranges.push(r); } const t = performance.now(); const ok = window.__softBlackoutRuntime.engine.commitRanges(ranges).ok; return { ok, ms: performance.now() - t, ranges: ranges.length }; }`);
    const scan = await send(popup, 'SCAN_PATTERNS', { email: true, url: true, phone: true });
    const scanned = scan.ok ? scan.data.pattern.total : 0;
    const apply = scan.ok && scanned ? await send(popup, 'APPLY_PATTERNS') : { ms: 0, ok: false };
    const appearance = await send(popup, 'SET_APPEARANCE', { style: 'marker', color: '#a65d51' });
    const undo = await send(popup, 'UNDO'), redo = await send(popup, 'REDO');
    // Poetry on a large paragraph: keep one word through the real in-page control, then apply.
    await send(popup, 'START_POETRY'); await popup.close(); await page.bringToFront();
    await page.evaluate(() => { const n = document.getElementById('p0').firstChild, r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 9); getSelection().removeAllRanges(); getSelection().addRange(r); document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })); });
    await sleep(40); await page.locator('[data-soft-blackout-owned="manual-context"]').getByRole('button', { name: 'Keep' }).click();
    popup = await browser.triggerAction(page); const poetry = await send(popup, 'APPLY_POETRY');
    const state = (await send(popup, 'GET_STATE')).data;
    const highlighted = await page.evaluate(() => { let n = 0; for (const [name, h] of CSS.highlights) if (name.startsWith('soft-blackout-v2-')) n += h.size; return n; });
    const reset = await send(popup, 'RESET');
    const reopen = []; for (let i = 0; i < 5; i++) { await popup.close(); const t = Date.now(); popup = await browser.triggerAction(page); reopen.push(Date.now() - t); }
    const afterReset = await page.evaluate(() => [...CSS.highlights.keys()].filter((name) => name.startsWith('soft-blackout')).length);
    const heapAfter = await heap(cdp);
    const longTasks = await page.evaluate(() => window.__longTasks);
    const row = { label, ...size, activation: activation.ms, commitOne: commitOne.ms, commitMany: commitMany.ms, manyRanges: commitMany.ranges, scan: scan.ms, scanned, scanError: scan.ok ? '' : scan.error.message, apply: apply.ms, appearance: appearance.ms, undo: undo.ms, redo: redo.ms, poetry: poetry.ms, poetryOk: poetry.ok, operations: state.history.undoCount, highlighted, reset: reset.ms, reopenMs: Math.max(...reopen), heapGrowthMb: heapAfter - heapBefore, longestTask: Math.max(0, ...longTasks) };
    rows.push(row);
    console.log(`[perf] ${label}: ${size.textNodes} text nodes, ${size.characters} chars | activate ${fmt(row.activation)} | 1 mask ${fmt(row.commitOne)} | ${row.manyRanges} ranges ${fmt(row.commitMany)} | scan ${fmt(row.scan)} (${scan.ok ? `${scanned} matches` : `refused: ${row.scanError}`}) | apply ${fmt(row.apply)} | appearance ${fmt(row.appearance)} | undo ${fmt(row.undo)} redo ${fmt(row.redo)} | poetry ${fmt(row.poetry)} | reset ${fmt(row.reset)} | reopen ≤${row.reopenMs}ms | ${row.highlighted} ranges/${row.operations} ops | heap Δ ${row.heapGrowthMb.toFixed(2)}MB after reset`);

    check(`${label}: masking operations stay interactive`, commitOne.ok && commitMany.ok && Math.max(row.commitOne, row.commitMany, row.undo, row.redo, row.appearance, row.reset) < BUDGET.interactiveMs * (paragraphs > 2000 ? 2 : 1));
    check(`${label}: activation within ${BUDGET.activationMs}ms`, row.activation < BUDGET.activationMs, fmt(row.activation));
    check(`${label}: Poetry applies on a large document`, poetry.ok, poetry.ok ? fmt(row.poetry) : poetry.error?.message);
    check(`${label}: Reset releases every highlight and stays near the baseline heap`, afterReset === 0 && row.heapGrowthMb < 5, `${row.heapGrowthMb.toFixed(2)}MB`);
    if (scan.ok) check(`${label}: Pattern scan and Apply complete`, apply.ok && scanned === Math.ceil(paragraphs / 25) && (paragraphs > 2000 || row.scan < BUDGET.scan5kMs), `${fmt(row.scan)} for ${scanned}`);
    else check(`${label}: oversized Pattern scan refuses safely instead of blocking`, /too large|too much text|Too many matches/.test(row.scanError) && row.scan < 1000, row.scanError);
    await page.close();
  }
} finally { server.close(); if (browser) await browser.close(); }
const failed = checks.filter((item) => !item.ok);
if (failed.length) { console.error(`${failed.length} performance check(s) failed`); process.exit(1); }
console.log(`[perf-browser] ${checks.length} checks passed`);
