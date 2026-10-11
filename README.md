<p align="center">
  <img src="icons/icon128.png" alt="Soft Blackout" width="96">
</p>

<h1 align="center">Soft Blackout</h1>

<p align="center">
  A Chrome extension that visually masks text on web pages,<br>
  by hand, as a blackout poem, or by pattern.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/soft-blackout/oeefplhfabbdadpicjbgbiapoadppkpo"><b>Install from the Chrome Web Store</b></a>
</p>

## How it works

1. Open a web page and click the **Soft Blackout** icon in the Chrome toolbar.
2. Choose **Manual**, **Poetry** or **Pattern Mask**.
3. Masks appear on the page right away. **Undo**, **Redo** and **Reset page** work across all three modes.

Soft Blackout runs on a page only after you use it there. Masks are kept in the page's memory and disappear when the page is reloaded or you navigate away.

## Manual

Choose **Start selecting**, select text on the page, then choose **Mask** in the small control next to your selection. Select text inside a mask and choose **Reveal** to remove just that part. **Done** ends the session and keeps your masks. `Esc` cancels a pending selection.

Turn on **Mask on select** to mask mouse selections right away, without the confirmation. **Reveal** and keyboard selections still ask first, and **Undo** takes back a mask you did not mean.

## Poetry

Make a blackout poem from any article. Choose **Start composing**, then select the words you want to keep and choose **Keep**; **Remove from poem** takes words back out. Kept words are previewed on the page; **Apply composition** hides the rest of each paragraph you kept words in, and **Cancel editing** discards the draft. **Edit composition** reopens your latest poem so you can keep more words or remove some.

Soft Blackout never picks words for you.

## Pattern Mask

Finds and masks common contact details:

- **Email** addresses
- **URL**s starting with `http://`, `https://` or `www.`
- **Phone** numbers with separators, such as `+44 20 7946 0958` or `(415) 555-0132` (off by default)

Choose the categories, **Scan page**, check the counts, then **Apply masks**. Scanning never masks anything on its own, and one Apply is one Undo step. If the page changes after a scan, scan again.

Matching is deliberately conservative and is not full personal-data detection. Addresses with non-Latin characters, phone numbers without separators and other formats are not matched.

## Styles and themes

- **Solid** covers text with a block of colour. **Marker** draws a thick band through it.
- Five colours: ink black, warm white, muted terracotta, warm taupe and muted sage.
- Changing the style or colour restyles every mask on the page at once.
- The popup and the on-page controls follow **System**, **Light** or **Dark** from Settings.

## Installation

**From the Chrome Web Store:** open [Soft Blackout on the Chrome Web Store](https://chromewebstore.google.com/detail/soft-blackout/oeefplhfabbdadpicjbgbiapoadppkpo) and choose **Add to Chrome**.

**From source** (Chrome 116 or newer, Node.js 22.12 or newer):

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select the `dist` folder.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Access the current tab, only after you use Soft Blackout there |
| `scripting` | Load the masking runtime into that tab |
| `storage` | Save your settings on this device |

Soft Blackout requests no host permissions, has no background service worker and no content scripts that run automatically.

## Privacy

Soft Blackout has no accounts, servers, analytics or tracking, and makes no network requests. Page text is processed in the tab and is never stored or sent anywhere. Only your settings (theme, last mode, Mask on select, pattern categories, style and colour) are saved, with `chrome.storage.local`.

Read the full [Privacy Policy](PRIVACY_POLICY.md).

## Good to know

- Works on regular websites. Chrome's own pages, the Chrome Web Store and local files cannot be changed.
- Text inside form fields, buttons, frames and closed shadow roots is not masked.
- If a site replaces the text under a mask (common on live-updating pages), that mask is dropped rather than moved to a guess.
- With **Windows High Contrast** (forced colors) on, masks cannot reliably hide text, so they are not drawn and new ones are refused.
- Pattern Mask refuses very large pages (over 10,000 text nodes or 250,000 characters in reading blocks) instead of scanning them partially.
- Selecting masked text keeps it hidden on screen, but copying it copies the original text.

## Development

```bash
npm run dev                         # rebuild dist on every change
npm test                            # unit tests
npm run check                       # typecheck, unit tests, production build and dist verification
npm run test:browser                # runtime lifecycle in real Chromium
npm run test:integration-browser    # all three modes together on one realistic page
npm run capture:visual              # Light/Dark screenshots of every popup state
```

Each area has its own Chromium suite: `test:engine-browser`, `test:manual-browser`, `test:poetry-browser`, `test:pattern-browser`, `test:ui-browser`, `test:theme-browser`, `test:render-browser` (pixel checks of every style and colour) and `test:perf-browser` (1k–10k text-node and ~500k-character pages). Browser tests need Playwright installed outside the project; see [tests/browser](tests/browser/README.md). Release notes are in the [Changelog](CHANGELOG.md).

### Release

`package.json` is the only place the version is set; the build writes it into `dist/manifest.json` and `dist/BUILD_ID`.

```bash
npm ci                    # clean install from the lockfile
npm run check             # typecheck, unit tests, build and dist verification
npm run package           # release/soft-blackout-<version>.zip, checked against the dist allowlist
```

Run the Chromium suites above against the same build before uploading the ZIP.

## Project structure

```text
src/engine/       Range validation, the shared operation ledger and the CSS Custom Highlight renderer
src/content/      injected runtime: Manual and Poetry sessions, Pattern Mask
src/shared/       settings, messages and constants
src/ui/popup/     popup markup, styles and logic
scripts/          production build, dist verification and release packaging
tests/unit/       unit, DOM and contrast tests
tests/browser/    real Chromium checks and local fixtures
icons/            extension icons
assets/brand/     icon SVG masters (128 and 16 px) and the icon renderer
```

## License

Released under the [MIT License](LICENSE).
