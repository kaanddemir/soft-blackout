// Visual QA capture: drives the real popup through each mode/state in Light and Dark and writes PNGs.
// Usage: PLAYWRIGHT_DIR=… node tests/browser/capture.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serveFixtures, sleep } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, '../../test-results/visual'));
fs.mkdirSync(out, { recursive: true });
const select = (page, selector, start, end) => page.evaluate(({ selector, start, end }) => {
  const node = document.querySelector(selector).firstChild, range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
}, { selector, start, end });

async function shoot(popup, name) {
  for (const theme of ['light', 'dark']) {
    await popup.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    // Wait for every running transition to settle (not a fixed delay), then one more frame.
    await popup.evaluate('new Promise(r=>requestAnimationFrame(()=>Promise.all(document.getAnimations().map(a=>a.finished)).then(()=>requestAnimationFrame(r))))');
    const shot = await popup.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(out, `${name}-${theme}.png`), Buffer.from(shot.data, 'base64'));
  }
  await popup.evaluate('delete document.documentElement.dataset.theme');
}

const { server, origin } = await serveFixtures(); let browser;
try {
  browser = await launch();
  const page = await browser.context.newPage({ viewport: { width: 900, height: 700 } }); await page.goto(`${origin}/engine.html`);
  let popup = await browser.triggerAction(page); await sleep(120);
  await shoot(popup, '01-manual');
  await popup.evaluate('settingsBtn.click()'); await sleep(40); await shoot(popup, '02-settings'); await popup.evaluate('closeSettingsBtn.click()');
  await popup.evaluate('poetryTab.click()'); await shoot(popup, '03-poetry');
  await popup.evaluate('patternTab.click()'); await shoot(popup, '04-pattern');
  await popup.evaluate("patternEmail.checked=false;patternUrl.checked=false;patternPhone.checked=false;patternEmail.dispatchEvent(new Event('change'))"); await sleep(40); await shoot(popup, '05-pattern-none-selected');
  await popup.evaluate("patternEmail.checked=true;patternUrl.checked=true;patternPhone.checked=true;patternEmail.dispatchEvent(new Event('change'));scanPatternsBtn.click()"); await sleep(150); await shoot(popup, '06-pattern-results');
  await popup.evaluate('applyPatternsBtn.click()'); await sleep(120); await shoot(popup, '07-pattern-applied');
  await popup.evaluate('manualTab.click();manualActionBtn.click()'); await sleep(120); await shoot(popup, '08-manual-active');
  await popup.close(); await page.bringToFront();
  await select(page, '#partial', 6, 17); await sleep(60); await page.screenshot({ path: path.join(out, '09-inpage-manual-context.png') });
  await page.locator('[data-soft-blackout-owned="manual-context"]').getByRole('button', { name: 'Mask' }).click(); await sleep(60);
  await page.locator('[data-soft-blackout-owned="manual-indicator"]').getByRole('button', { name: 'Done' }).click(); await sleep(60);
  popup = await browser.triggerAction(page); await sleep(100);
  await popup.evaluate('poetryTab.click();poetryActionBtn.click()'); await sleep(100); await popup.close(); await page.bringToFront();
  await select(page, '#duplicate', 0, 6); await sleep(60); await page.screenshot({ path: path.join(out, '10-inpage-poetry-context.png') });
  await page.locator('[data-soft-blackout-owned="manual-context"]').getByRole('button', { name: 'Keep' }).click(); await sleep(60);
  await page.emulateMedia({ colorScheme: 'dark' }); await select(page, '#duplicate', 8, 12); await sleep(60); await page.screenshot({ path: path.join(out, '11-inpage-dark.png') });
  await page.keyboard.press('Escape'); await page.emulateMedia({ colorScheme: 'light' });
  popup = await browser.triggerAction(page); await sleep(100); await shoot(popup, '12-poetry-pending');
  await popup.evaluate('applyPoetryBtn.click()'); await sleep(120); await shoot(popup, '13-poetry-applied');
  console.log(`[capture] wrote ${fs.readdirSync(out).length} files to ${out}`);
} finally { server.close(); if (browser) await browser.close(); }
