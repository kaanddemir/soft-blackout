// Rendered-pixel audit of CSS Custom Highlight masks: Solid and Marker in all five colours on light, dark and tinted
// backgrounds, zoom, native selection over masks, and the forced-colors fallback.
import { createRequire } from 'node:module';
import path from 'node:path';
import { launch, serveFixtures, sleep } from './harness.mjs';

const { PNG } = createRequire(import.meta.url)(path.join(process.env.PLAYWRIGHT_DIR, 'playwright-core/lib/utilsBundle.js'));
const checks = [];
const check = (name, value, detail = '') => { checks.push({ name, ok: Boolean(value) }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const COLORS = ['#242321', '#f7f4ec', '#a65d51', '#a8977c', '#65786c'];
const execute = (popup, body, args = []) => popup.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>chrome.scripting.executeScript({target:{tabId:tab.id},func:${body},args:${JSON.stringify(args)}}).then(([r])=>r.result))`);
// Share of pixels matching the mask colour, and count of pixels matching the fixture's glyph colour (#dd1111 / white on dark).
function stats(buffer, hex, glyph) {
  const png = PNG.sync.read(buffer), target = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); let mask = 0, glyphs = 0, total = 0;
  // Skip the outer 2px: element screenshots at fractional positions include a sliver of the surrounding page.
  for (let i = 0; i < png.data.length; i += 4) {
    const x = (i / 4) % png.width, y = Math.floor(i / 4 / png.width);
    if (x < 2 || y < 2 || x >= png.width - 2 || y >= png.height - 2) continue;
    const [r, g, b] = png.data.subarray(i, i + 3); total++;
    if (Math.abs(r - target[0]) < 16 && Math.abs(g - target[1]) < 16 && Math.abs(b - target[2]) < 16) mask++;
    if (glyph(r, g, b)) glyphs++;
  }
  return { mask: mask / total, glyphs };
}
const red = (r, g, b) => r > 150 && g < 80 && b < 80;
const white = (r, g, b) => r > 240 && g > 240 && b > 240;
const maskAll = (popup, ids, style, color) => execute(popup, `(ids, s, c) => { const e = window.__softBlackoutRuntime.engine; e.reset();
  return ids.map((id) => { const walker = document.createTreeWalker(document.getElementById(id), NodeFilter.SHOW_TEXT); const first = walker.nextNode(); let last = first; while (walker.nextNode()) last = walker.currentNode;
    const r = document.createRange(); r.setStart(first, 0); r.setEnd(last, last.length); return e.commitRanges([r], 'manual', 'mask', { style: s, color: c }).ok; }); }`, [ids, style, color]);

const { server, origin } = await serveFixtures(); let browser;
try {
  browser = await launch();
  const page = await browser.context.newPage({ viewport: { width: 900, height: 760 } }); await page.goto(`${origin}/engine.html`);
  const popup = await browser.triggerAction(page);
  await popup.evaluate('manualActionBtn.click()'); await sleep(100); await popup.evaluate('manualActionBtn.click()'); await sleep(60);

  const coverage = { solid: [], marker: [] };
  for (const style of ['solid', 'marker']) for (const color of COLORS) {
    const ok = await maskAll(popup, ['partial', 'dark', 'nested'], style, color); await sleep(40);
    const light = stats(await page.locator('#partial').screenshot(), color, red), dark = stats(await page.locator('#dark').screenshot(), color, white), nested = stats(await page.locator('#nested').screenshot(), color, red);
    coverage[style].push(light.mask);
    check(`${style} ${color} hides glyphs and paints the mask on light, dark and nested text`, ok.every(Boolean) && light.glyphs === 0 && dark.glyphs === 0 && nested.glyphs === 0 && light.mask > 0.1 && dark.mask > 0.1, `light ${light.mask.toFixed(2)} dark ${dark.mask.toFixed(2)}`);
  }
  check('Marker is visibly distinct from Solid (narrower band)', Math.max(...coverage.marker) < Math.min(...coverage.solid) * 0.8, `solid ${Math.min(...coverage.solid).toFixed(2)} marker ${Math.max(...coverage.marker).toFixed(2)}`);

  await maskAll(popup, ['responsive', 'large'], 'solid', '#242321');
  await page.evaluate(() => { document.body.style.zoom = '1.6'; }); await sleep(60);
  const zoomed = stats(await page.locator('#responsive').screenshot(), '#242321', red);
  check('masks follow zoom and reflow without exposing glyphs', zoomed.glyphs === 0 && zoomed.mask > 0.15, zoomed.mask.toFixed(2));
  await page.evaluate(() => { document.body.style.zoom = ''; document.getElementById('responsive').style.width = '260px'; }); await sleep(60);
  const narrow = stats(await page.locator('#responsive').screenshot(), '#242321', red);
  check('masks follow a narrow responsive reflow', narrow.glyphs === 0 && narrow.mask > 0.15, narrow.mask.toFixed(2));
  await page.evaluate(() => { document.getElementById('responsive').style.width = ''; });

  for (const style of ['solid', 'marker']) {
    await maskAll(popup, ['partial'], style, '#a65d51');
    await page.evaluate(() => { const node = document.getElementById('partial').firstChild, range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); }); await sleep(40);
    const selected = stats(await page.locator('#partial').screenshot(), '#a65d51', red);
    check(`native selection over a ${style} mask does not reveal glyphs`, selected.glyphs === 0, `glyph pixels ${selected.glyphs}`);
    check(`text stays selectable and in the DOM under a ${style} mask`, await page.evaluate(() => getSelection().toString() === 'alpha partialword omega'));
    await page.evaluate(() => getSelection().removeAllRanges());
  }

  await maskAll(popup, ['partial'], 'solid', '#242321');
  await page.emulateMedia({ forcedColors: 'active' }); await sleep(60);
  const forced = await page.evaluate(() => getSelection().toString() === '' && document.getElementById('partial').textContent);
  const forcedStats = stats(await page.locator('#partial').screenshot(), '#242321', () => false);
  check('forced colors drop the visual mask instead of pretending to hide text', forced === 'alpha partialword omega' && forcedStats.mask < 0.05, forcedStats.mask.toFixed(2));
  await page.emulateMedia({ forcedColors: 'none' });
} finally { server.close(); if (browser) await browser.close(); }
const failed = checks.filter((item) => !item.ok);
if (failed.length) { console.error(`${failed.length} render check(s) failed`); process.exit(1); }
console.log(`[render-browser] ${checks.length} checks passed`);
