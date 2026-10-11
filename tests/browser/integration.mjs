// Cross-mode integration on one document: Manual, Poetry and Pattern Mask share one ledger, one history and one
// highlight registry. Also covers DOM integrity, framework replacement, page functionality and storage privacy.
import { launch, serveFixtures, sleep } from './harness.mjs';

const checks = [];
const check = (name, value, detail = '') => { checks.push({ name, ok: Boolean(value) }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const send = (popup, type, payload = null) => popup.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>chrome.tabs.sendMessage(tab.id,{marker:'soft-blackout',version:1,buildId:chrome.runtime.getManifest().version,requestId:'it-'+Math.random(),type:${JSON.stringify(type)},payload:${JSON.stringify(payload)}}))`);
const state = async (popup) => (await send(popup, 'GET_STATE')).data;
const context = (page) => page.locator('[data-soft-blackout-owned="manual-context"]');
// Selects `word` inside the first text node under `selector` that contains it, like a user drag would.
const selectWord = (page, selector, word) => page.evaluate(({ selector, word }) => {
  const walker = document.createTreeWalker(document.querySelector(selector), NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, index = node.data.indexOf(word);
    if (index < 0) continue;
    const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + word.length);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })); return true;
  }
  return false;
}, { selector, word });
const confirmInPage = async (page, selector, word, label) => { await selectWord(page, selector, word); await sleep(40); await context(page).getByRole('button', { name: label }).click(); await sleep(40); };
// Live registry view: total registered ranges and their highlight names.
const highlights = (page) => page.evaluate(() => { let ranges = 0; const names = []; for (const [name, highlight] of CSS.highlights) if (name.startsWith('soft-blackout-v2-')) { ranges += highlight.size; names.push(name); } return { ranges, names }; });
const domFingerprint = (page) => page.evaluate(() => { const walker = document.createTreeWalker(document.querySelector('article'), NodeFilter.SHOW_TEXT); let nodes = 0, text = ''; while (walker.nextNode()) if (walker.currentNode.parentElement.closest('#headline,#col-a,#col-b,#bidi,#tbody,#lazy,#dense,#framework')) { nodes++; text += walker.currentNode.data; } return { nodes, length: text.length, text }; });

const { server, origin } = await serveFixtures(); let browser;
try {
  browser = await launch();
  const page = await browser.context.newPage({ viewport: { width: 1000, height: 760 } });
  await page.goto(`${origin}/compat.html`); await sleep(120);
  const pristine = await domFingerprint(page);
  let popup = await browser.triggerAction(page);

  // 1. Manual first.
  await popup.evaluate('manualActionBtn.click()'); await page.locator('[data-soft-blackout-owned="manual-indicator"]').waitFor();
  await popup.close(); await page.bringToFront();
  await confirmInPage(page, '#headline', 'council', 'Mask');
  await page.locator('#inline-link').click(); await page.locator('#submit').click(); await page.locator('#nav-route').click();
  check('page links, forms and client routes keep working during Manual editing', await page.evaluate(() => window.clicks === 1 && document.getElementById('form-status').textContent === 'submitted:Ada' && location.search === '?route=2'));
  await page.evaluate(() => scrollTo(0, 400)); await selectWord(page, '#dense', 'reflow'); await sleep(60);
  const box = await context(page).boundingBox();
  check('selection controls stay inside the viewport after scrolling under a sticky header', box && box.y >= 0 && box.y + box.height <= 760, JSON.stringify(box));
  await page.keyboard.press('Escape'); await page.evaluate(() => scrollTo(0, 0));
  // Abandoned confirmation: clicking elsewhere, or dragging a new selection, must not leave the old control behind.
  await selectWord(page, '#col-a', 'budgets'); await sleep(40);
  await page.mouse.click(900, 700); await sleep(60);
  check('clicking elsewhere dismisses a pending confirmation', await context(page).count() === 0);
  await selectWord(page, '#col-a', 'budgets'); await sleep(40);
  const word = await page.evaluate(() => { const n = document.getElementById('dense').firstChild, r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 5); const b = r.getBoundingClientRect(); return { x1: b.left + 1, x2: b.right - 1, y: b.top + b.height / 2 }; });
  await page.mouse.move(word.x1, word.y); await page.mouse.down(); await page.mouse.move(word.x2, word.y, { steps: 4 }); await page.mouse.up(); await sleep(60);
  const ctx = await page.evaluate(() => { const h = [...document.querySelectorAll('[data-soft-blackout-owned="manual-context"]')]; return { count: h.length, top: h[0] && parseFloat(h[0].style.top), dense: document.getElementById('dense').getBoundingClientRect().top }; });
  check('dragging a new selection replaces the old confirmation', ctx.count === 1 && ctx.top < ctx.dense, JSON.stringify(ctx));
  await page.keyboard.press('Escape');
  await confirmInPage(page, '#lazy', 'arrived', 'Mask');
  check('lazy-loaded text can be masked', (await highlights(page)).ranges === 2);
  await page.locator('[data-soft-blackout-owned="manual-indicator"]').getByRole('button', { name: 'Done' }).click();

  // 2. Poetry after Manual.
  popup = await browser.triggerAction(page); await popup.evaluate('poetryTab.click();poetryActionBtn.click()'); await sleep(80); await popup.close(); await page.bringToFront();
  await confirmInPage(page, '#col-a', 'budgets', 'Keep');
  await selectWord(page, '#headline', 'council'); await sleep(40); await context(page).getByRole('button', { name: /Keep|Remove from poem/ }).click(); await sleep(40);
  popup = await browser.triggerAction(page); let s = await state(popup);
  check('Poetry refuses to keep text already masked by Manual', s.poetry.keptCount === 1, JSON.stringify(s.poetry));
  check('popup reopening preserves the pending draft', await popup.evaluate("poetryStats.textContent==='1 kept · 1 block'"));
  const manualBlocked = await send(popup, 'START_EDITING', { mode: 'manual' });
  check('switching to Manual with a pending draft is refused without losing it', !manualBlocked.ok && (await state(popup)).poetry.keptCount === 1);
  const patternBlocked = await send(popup, 'SCAN_PATTERNS', { email: true, url: true, phone: true });
  check('scanning with a pending draft is refused without losing it', !patternBlocked.ok && (await state(popup)).poetry.keptCount === 1);
  await send(popup, 'APPLY_POETRY'); s = await state(popup);
  check('Poetry applies as one operation after Manual', s.history.undoCount === 3 && s.poetry.compositionCount === 1 && s.manual.maskedCount === 2, JSON.stringify(s.history));

  // 3. Pattern after Poetry and Manual.
  const before = await highlights(page);
  await send(popup, 'SCAN_PATTERNS', { email: true, url: true, phone: true }); s = await state(popup);
  check('Scan never applies masks', (await highlights(page)).ranges === before.ranges && s.history.undoCount === 3);
  check('Scan finds column contacts and table emails', s.pattern.counts.email === 41 && s.pattern.counts.url === 1 && s.pattern.counts.phone === 1, JSON.stringify(s.pattern.counts));
  await send(popup, 'APPLY_PATTERNS'); s = await state(popup);
  const afterPattern = await highlights(page);
  check('one Apply is one history entry over all matches', s.history.undoCount === 4 && afterPattern.ranges === before.ranges + 43, `${before.ranges}→${afterPattern.ranges}`);
  await send(popup, 'SCAN_PATTERNS', { email: true, url: true, phone: true }); s = await state(popup);
  check('rescanning skips matches that are already masked', s.pattern.status === 'scanned' && s.pattern.total === 0, JSON.stringify(s.pattern));
  await send(popup, 'CANCEL_PATTERN_SCAN');

  // 4. Manual after Pattern.
  await send(popup, 'START_EDITING', { mode: 'manual' }); await popup.close(); await page.bringToFront();
  await confirmInPage(page, '#bidi', "İstanbul'da", 'Mask');
  popup = await browser.triggerAction(page); await send(popup, 'STOP_EDITING'); s = await state(popup);
  check('Manual after Pattern joins the same history', s.history.undoCount === 5 && s.manual.maskedCount === 3);

  // 5. Undo/Redo across modes in exact reverse order.
  const order = [];
  for (let step = 0; step < 5; step++) { await send(popup, 'UNDO'); const now = await state(popup); order.push(`${now.manual.maskedCount}/${(await highlights(page)).ranges}`); }
  check('Undo walks Manual → Pattern → Poetry → Manual → Manual', order.join(' ') === `2/${afterPattern.ranges} 2/${before.ranges} 2/2 1/1 0/0`, order.join(' '));
  for (let step = 0; step < 5; step++) await send(popup, 'REDO');
  s = await state(popup);
  check('Redo restores every mode without duplicate registrations', s.history.undoCount === 5 && (await highlights(page)).ranges === afterPattern.ranges + 1, String((await highlights(page)).ranges));

  // 6. Appearance changes apply to every mode without touching history.
  await popup.evaluate("document.querySelector('[data-style=marker]').click();document.querySelector('[data-color=\"#65786c\"]').click()"); await sleep(120); s = await state(popup);
  const marked = await highlights(page);
  check('appearance change restyles all modes and leaves history untouched', s.history.undoCount === 5 && s.history.redoCount === 0 && marked.names.length === 1 && marked.names[0] === 'soft-blackout-v2-marker-65786c', marked.names.join());

  // 7. Poetry refinement after later operations keeps the current appearance.
  await send(popup, 'EDIT_POETRY'); await popup.close(); await page.bringToFront();
  await confirmInPage(page, '#col-a', 'residents', 'Keep');
  popup = await browser.triggerAction(page); await send(popup, 'APPLY_POETRY'); s = await state(popup);
  const revised = await highlights(page);
  check('revising a composition is one revision entry and keeps the chosen style', s.history.undoCount === 6 && revised.names.join() === 'soft-blackout-v2-marker-65786c', revised.names.join());
  await send(popup, 'UNDO'); s = await state(popup);
  check('undoing the revision restores the earlier poem and leaves Pattern and Manual intact', s.history.undoCount === 5 && s.manual.maskedCount === 3 && (await highlights(page)).ranges === afterPattern.ranges + 1);
  await send(popup, 'REDO');

  // 8. Failed operations do not corrupt history.
  const failedApply = await send(popup, 'APPLY_POETRY'); const failedUndoCount = (await state(popup)).history.undoCount;
  check('a failed Apply leaves history unchanged', !failedApply.ok && failedUndoCount === 6);

  // 9. Framework replacement of a masked node invalidates safely rather than guessing.
  await send(popup, 'START_EDITING', { mode: 'manual' }); await popup.close(); await page.bringToFront();
  await confirmInPage(page, '#fw-span', 'bravo', 'Mask');
  const withFramework = (await highlights(page)).ranges;
  await page.evaluate(() => window.replaceFramework());
  popup = await browser.triggerAction(page); await sleep(80); await send(popup, 'SET_APPEARANCE', { style: 'marker', color: '#65786c' }); s = await state(popup);
  check('replaced framework text is invalidated, not re-targeted', s.manual.invalidatedCount >= 1 && (await highlights(page)).ranges === withFramework - 1, `${withFramework}→${(await highlights(page)).ranges}`);
  await send(popup, 'STOP_EDITING');

  // 10. DOM integrity and Reset.
  const during = await domFingerprint(page);
  check('masking never splits or rewrites page text', during.nodes === pristine.nodes && during.text === pristine.text);
  await page.evaluate(() => document.getElementById('lede').append(' Independent page edit.'));
  await send(popup, 'RESET'); s = await state(popup);
  check('Reset clears every mode and all registrations', s.history.undoCount === 0 && s.history.redoCount === 0 && (await highlights(page)).ranges === 0 && !s.pending);
  check('Reset keeps independent page changes', await page.evaluate(() => document.getElementById('lede').textContent.endsWith('Independent page edit.')));
  check('Reset leaves one runtime and one style owner', await page.evaluate(() => document.querySelectorAll('[data-soft-blackout-owned="engine-styles"]').length <= 1 && document.querySelectorAll('[data-soft-blackout-owned="manual-indicator"]').length === 0));

  // 11. Reset and Dispose during pending work.
  const owned = () => page.evaluate(() => ({ hosts: document.querySelectorAll('[data-soft-blackout-owned^="manual-"]').length, preview: CSS.highlights.has('soft-blackout-poetry-preview') && CSS.highlights.get('soft-blackout-poetry-preview').size > 0 }));
  await send(popup, 'START_POETRY'); await popup.close(); await page.bringToFront(); await confirmInPage(page, '#col-b', 'contacts', 'Keep');
  popup = await browser.triggerAction(page); await send(popup, 'RESET'); s = await state(popup); let o = await owned();
  check('Reset during a pending Poetry draft discards it and its previews', s.poetry.keptCount === 0 && !s.editing.active && o.hosts === 0 && !o.preview, JSON.stringify(o));
  await send(popup, 'SCAN_PATTERNS', { email: true, url: false, phone: false }); await send(popup, 'RESET'); s = await state(popup);
  check('Reset after a Pattern scan returns to idle without masking', s.pattern.status === 'idle' && s.history.undoCount === 0 && (await highlights(page)).ranges === 0);
  await send(popup, 'START_POETRY'); await popup.close(); await page.bringToFront(); await confirmInPage(page, '#col-b', 'contacts', 'Keep');
  popup = await browser.triggerAction(page); const disposed = await send(popup, 'DISPOSE'); o = await owned();
  check('Dispose during Poetry editing removes controls and previews', disposed.ok && o.hosts === 0 && !o.preview, JSON.stringify(o));
  await popup.evaluate("settingsBtn.click();document.querySelector('input[value=dark]').click()"); await sleep(80);
  check('a disposed runtime ignores later theme changes', (await owned()).hosts === 0 && await page.evaluate(() => !window.__softBlackoutRuntime));
  await popup.evaluate("document.querySelector('input[value=system]').click()"); await sleep(40); await popup.close();
  popup = await browser.triggerAction(page); await popup.evaluate('manualTab.click();manualActionBtn.click()'); await page.locator('[data-soft-blackout-owned="manual-indicator"]').waitFor();
  check('reinjection after Dispose yields exactly one runtime UI', (await owned()).hosts === 1 && (await state(popup)).history.undoCount === 0);
  await send(popup, 'STOP_EDITING');

  // 12. Storage after a realistic mixed workflow.
  const stored = await popup.evaluate('chrome.storage.local.get(null)'); const raw = JSON.stringify(stored);
  check('storage holds preferences only after mixed modes', Object.keys(stored).every((key) => ['preferences', 'blackoutAppearance', 'patternCategories'].includes(key))
    && !['council', 'budgets', 'residents', 'press@council', 'İstanbul', 'compat.html', 'route='].some((needle) => raw.includes(needle)), raw);
} finally { server.close(); if (browser) await browser.close(); }
const failed = checks.filter((item) => !item.ok);
if (failed.length) { console.error(`${failed.length} integration check(s) failed`); process.exit(1); }
console.log(`[integration-browser] ${checks.length} checks passed`);
