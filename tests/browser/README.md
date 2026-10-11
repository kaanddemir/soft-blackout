# Browser tests

Real Chromium checks for the built extension (`dist/`). They open the real toolbar popup and run against
local fixtures. They complement the unit tests (`npm test`), which stay the standard validation for every
change.

## Setup

Playwright is not a project dependency. Point `PLAYWRIGHT_DIR` at a directory that contains the
`playwright` package (an npx cache works) and install Chromium once:

```sh
npx playwright install chromium
export PLAYWRIGHT_DIR=~/.npm/_npx/<hash>/node_modules
```

The harness uses Playwright's Chromium. Set `CHROME_PATH` to use another Chromium or Chrome for Testing
build (branded Chrome ignores `--load-extension`). Each run uses a temporary browser profile in the OS
temp directory. Without `PLAYWRIGHT_DIR` a suite exits with status 2; it is never reported as skipped or
passing.

Every `npm run test:*-browser` command builds `dist/` first. Suites can also be run directly with
`node tests/browser/<suite>.mjs` against an existing build.

## Commands

| Command | Suite | Covers |
| --- | --- | --- |
| `npm run test:browser` | `run.mjs` | toolbar popup, typed protocol, runtime lifecycle, stale-runtime replacement, tab isolation, navigation cleanup |
| `npm run test:engine-browser` | `engine.mjs` | Range ownership, Custom Highlight rendering, history, mutation invalidation, shadow roots, reflow, zoom |
| `npm run test:manual-browser` | `manual.mjs` | Mask and Reveal by pointer and keyboard, in-page controls, forced colors, popup sync, cleanup |
| `npm run test:poetry-browser` | `poetry.mjs` | Keep previews, Apply composition across blocks, Edit composition, forced colors, runtime-only drafts |
| `npm run test:pattern-browser` | `pattern.mjs` | category matching, Scan and Apply separation, one-step history, page changes after a scan, saved categories |
| `npm run test:ui-browser` | `ui.mjs` | popup layout, tabs and Settings, themes, Solid/Marker and colours, Reset page confirmation |
| `npm run test:theme-browser` | `theme.mjs` | System Dark first paint, on-page control theming, Settings focus and radio keyboard behaviour |
| `npm run test:integration-browser` | `integration.mjs` | all three modes on one realistic page (`fixtures/compat.html`) |
| `npm run test:render-browser` | `render.mjs` | pixel checks of both styles in all five colours, zoom, reflow, selection over masks, forced colors |
| `npm run test:perf-browser` | `perf.mjs` | timings on generated 1k–10k text-node and ~500k-character pages |
| `npm run capture:visual` | `capture.mjs` | Light and Dark screenshots of every popup state for visual review |

None of the suites need the network.

## Which tests to run

| Change | Run |
| --- | --- |
| Small change | `npm test` and the touched mode's suite, e.g. `npm run test:manual-browser` |
| Popup or theme change | `npm test`, `test:ui-browser`, `test:theme-browser` and `capture:visual` |
| Engine or rendering change | `npm run check`, `test:engine-browser`, `test:render-browser` and `test:perf-browser` |
| Release | `npm run check`, then every suite above against the same build |

## Output

The UI suite writes `soft-blackout-light.png` and `soft-blackout-dark.png` to `test-results/`, and
`capture:visual` writes to `test-results/visual/` (or a directory passed as its first argument). The folder
is git-ignored.

Local fixtures live in `fixtures/` and are served from `127.0.0.1`.
