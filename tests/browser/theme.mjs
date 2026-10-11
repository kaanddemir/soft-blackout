// Real toolbar flow under a system Dark appearance (Chromium --force-dark-mode), first paint, reopen,
// live system changes, popup theme override, and in-page control theming.
import { launch, serveFixtures, sleep } from './harness.mjs';
const checks = [];
const check = (name, value, detail = '') => { checks.push({ name, ok: Boolean(value) }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const DARK = 'rgb(23, 23, 23)', LIGHT = 'rgb(246, 243, 238)';
const bg = (target, selector) => target.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`);
const select = (page, selector, start, end) => page.evaluate(({ selector, start, end }) => {
  const node = document.querySelector(selector).firstChild, range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
}, { selector, start, end });
const panelBg = (page, owner) => page.evaluate((owner) => { const host = document.querySelector(`[data-soft-blackout-owned="${owner}"]`); return host ? getComputedStyle(host.shadowRoot.querySelector('.panel')).backgroundColor : null; }, owner);

const { server, origin } = await serveFixtures(); let browser;
try {
  browser = await launch({ args: ['--force-dark-mode'], contextOptions: { colorScheme: null } });
  const page = await browser.context.newPage({ viewport: { width: 900, height: 700 }, colorScheme: null }); await page.goto(`${origin}/engine.html`);
  check('system Dark is reported to web content', await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches));

  let popup = await browser.triggerAction(page);
  check('toolbar popup follows system Dark without an override', await popup.evaluate("!document.documentElement.dataset.theme&&matchMedia('(prefers-color-scheme: dark)').matches"));
  // The html canvas is painted from CSS alone (before popup.js runs); body stays hidden until ready, so no Light flash is possible.
  check('first paint canvas is Dark from CSS alone', await popup.evaluate(`(()=>{const html=getComputedStyle(document.documentElement).backgroundColor;return html===${JSON.stringify(DARK)}})()`));
  check('popup body, tabs, primary action and footer use Dark tokens', await bg(popup, 'body') === DARK
    && await bg(popup, '[role=tab][aria-selected=true]') === 'rgb(234, 227, 216)'
    && await bg(popup, '#manualActionBtn') === 'rgb(234, 227, 216)'
    && await popup.evaluate("getComputedStyle(document.querySelector('footer')).borderTopColor==='rgb(66, 66, 66)'&&getComputedStyle(document.querySelector('h1')).color==='rgb(241, 237, 230)'"));
  await popup.evaluate('settingsBtn.click()'); await sleep(30);
  check('settings panel uses the Dark elevated surface', await bg(popup, '#settingsPanel') === 'rgb(37, 37, 37)');
  await popup.close();
  popup = await browser.triggerAction(page);
  check('reopened toolbar popup stays Dark', await bg(popup, 'body') === DARK);

  await popup.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }); await sleep(30);
  check('live system appearance change to Light is followed', await bg(popup, 'body') === LIGHT);
  await popup.send('Emulation.setEmulatedMedia', { features: [] }); await sleep(30);

  // In-page controls follow the explicit preference, not only the system.
  await popup.evaluate('manualActionBtn.click()'); await page.locator('[data-soft-blackout-owned="manual-indicator"]').waitFor();
  check('in-page indicator follows System (Dark)', await panelBg(page, 'manual-indicator') === 'rgb(37, 37, 37)');
  await popup.evaluate("settingsBtn.click();document.querySelector('input[value=light]').click()"); await sleep(120);
  check('Light preference re-themes the active indicator live', await panelBg(page, 'manual-indicator') === LIGHT);
  await popup.close(); await page.bringToFront();
  await select(page, '#partial', 6, 17); await sleep(60);
  check('new selection controls use the Light preference', await panelBg(page, 'manual-context') === LIGHT);
  await page.keyboard.press('Escape');
  popup = await browser.triggerAction(page);
  check('reopened popup keeps the Light override over system Dark', await popup.evaluate("document.documentElement.dataset.theme==='light'") && await bg(popup, 'body') === LIGHT);
  await popup.evaluate("settingsBtn.click();document.querySelector('input[value=dark]').click()"); await sleep(120);
  await page.emulateMedia({ colorScheme: 'light' });
  check('Dark preference forces Dark controls over a Light system', await panelBg(page, 'manual-indicator') === 'rgb(37, 37, 37)');
  await popup.evaluate("document.querySelector('input[value=system]').click()"); await sleep(120);
  check('System preference returns to following the page system appearance', await panelBg(page, 'manual-indicator') === LIGHT);
  check('theme changes do not duplicate in-page hosts', await page.evaluate(() => document.querySelectorAll('[data-soft-blackout-owned="manual-indicator"]').length === 1));
  const appearance = await popup.evaluate("chrome.storage.local.get('blackoutAppearance')");
  check('theme preference is independent of the mask colour', !appearance.blackoutAppearance || appearance.blackoutAppearance.color === '#242321');
  await popup.evaluate('manualActionBtn.click()'); await sleep(60);

  // Navigation: a new document gets a fresh runtime; theme preference survives in storage only.
  await page.goto(`${origin}/article.html`);
  popup = await browser.triggerAction(page); await popup.evaluate("settingsBtn.click();document.querySelector('input[value=dark]').click()"); await sleep(60);
  check('theme change on a page without a runtime is handled gracefully', await popup.evaluate("document.getElementById('status').dataset.error!=='true'"));
  await popup.evaluate("closeSettingsBtn.click();manualActionBtn.click()"); await page.locator('[data-soft-blackout-owned="manual-indicator"]').waitFor();
  await sleep(80); check('runtime injected after navigation picks up the stored Dark preference', await panelBg(page, 'manual-indicator') === 'rgb(37, 37, 37)');
  await popup.evaluate("manualActionBtn.click();settingsBtn.click();document.querySelector('input[value=system]').click()");

  // Settings focus restoration with real input events.
  popup = await browser.triggerAction(page);
  const click = async (id) => { const box = await popup.evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await popup.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 }); await sleep(40); };
  const key = async (key, code, keyCode, text) => { await popup.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) }); await popup.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode }); await sleep(40); };
  const focusState = (id) => popup.evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});return{focused:document.activeElement===el,ring:el.matches(':focus-visible')}})()`);
  await click('settingsBtn'); let f = await focusState('closeSettingsBtn');
  check('pointer open moves focus into Settings without a keyboard ring', f.focused && !f.ring, JSON.stringify(f));
  await click('closeSettingsBtn'); f = await focusState('settingsBtn');
  check('pointer close restores focus to the trigger without a keyboard ring', f.focused && !f.ring, JSON.stringify(f));
  await key('Enter', 'Enter', 13, '\r'); f = await focusState('closeSettingsBtn');
  check('keyboard open focuses Close with a visible ring', f.focused && f.ring, JSON.stringify(f));
  await key('Escape', 'Escape', 27); f = await focusState('settingsBtn');
  check('Escape closes Settings and restores a visible keyboard focus ring', f.focused && f.ring && await popup.evaluate('settingsPanel.hidden'), JSON.stringify(f));

  // Radio groups: roving tabindex and arrow keys with real key events.
  const checkedColor = () => popup.evaluate("document.querySelector('.swatch[aria-checked=true]').dataset.color");
  check('only the checked style and colour are Tab stops', await popup.evaluate("[...document.querySelectorAll('.style-choice,.swatch')].filter(b=>b.tabIndex===0).length===2"));
  await popup.evaluate("document.querySelector('.swatch[aria-checked=true]').focus()");
  const startColor = await checkedColor();
  await key('ArrowRight', 'ArrowRight', 39); const movedColor = await checkedColor();
  check('ArrowRight selects and focuses the next colour', movedColor !== startColor && await popup.evaluate("document.activeElement.getAttribute('aria-checked')==='true'&&document.activeElement.classList.contains('swatch')"), `${startColor}→${movedColor}`);
  await key('Home', 'Home', 36); check('Home selects the first colour', await checkedColor() === '#242321');
  await popup.evaluate("document.querySelector('.style-choice[aria-checked=true]').focus()"); await key('ArrowRight', 'ArrowRight', 39);
  check('arrow keys switch Solid/Marker', await popup.evaluate("document.querySelector('.style-choice[aria-checked=true]').dataset.style==='marker'"));
  await key('ArrowLeft', 'ArrowLeft', 37);
  const order = await popup.evaluate("[...document.querySelectorAll('button,input,[tabindex]')].filter(e=>!e.disabled&&e.tabIndex>=0&&e.offsetParent).map(e=>e.id||e.dataset.style||e.dataset.color||e.value).join(' ')");
  check('Tab order follows the visual layout', order === 'settingsBtn manualTab solid #242321 resetRedactBtn' || order.startsWith('settingsBtn manualTab manualActionBtn autoMask solid #242321'), order);
} finally { server.close(); if (browser) await browser.close(); }
const failed = checks.filter((item) => !item.ok);
if (failed.length) { console.error(`${failed.length} theme check(s) failed`); process.exit(1); }
console.log(`[theme-browser] ${checks.length} checks passed`);
