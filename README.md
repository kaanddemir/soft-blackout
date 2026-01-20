# Soft Blackout

<p align="center">
  <img src="icons/icon128.png" alt="Soft Blackout Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Selectively redact text on web pages.</strong>
  <br>
  <em>Privacy-respecting • Runs only when you need it</em>
</p>

---

## Features

- **Manual Mode** — Click and drag to select text you want to redact
- **Smart Redact** — Intelligent redaction with customizable settings
  - Three modes: Poetry, Privacy, and Random
  - Intensity presets: Light, Medium, Heavy
  - Keep Visible filters for proper nouns, long words, and numbers
- **Blackout All** — Redact entire page content with one click (including links)
- **Undo/Redo** — Easily revert or reapply redaction actions
- **Reset** — Restore the original page content
- **Double-click to Reveal** — Double-click any redacted text to un-redact it
- **Privacy-First** — Only runs when you explicitly interact with the extension

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `Soft Blackout` folder

## Usage

1. Click the Soft Blackout icon in your Chrome toolbar
2. Choose your mode:
   - Toggle **Manual Mode** to select and redact text by clicking and dragging
   - Click **Smart Redact** for intelligent automatic redaction
   - Click the ⚙️ button to open **Redaction Settings**:
     - **Mode**: Poetry (for blackout poetry), Privacy (hide sensitive data), Random
     - **Intensity**: Light (25%), Medium (50%), Heavy (75%)
     - **Keep Visible**: Proper nouns, Long words (4+ chars), Numbers & Dates
   - Click **Blackout All** to redact everything on the page
3. Use **Undo/Redo** buttons to revert or reapply actions
4. Click **Reset** to restore the original page
5. **Double-click** any redacted text to reveal it

## Project Structure

```
Soft Blackout/
├── manifest.json          # Extension configuration (Manifest V3)
├── popup.html             # Popup UI with settings modal
├── README.md              # This file
├── PRIVACY.md             # Privacy policy
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── css/
    │   └── styles.css     # Content script styles
    └── js/
        ├── content.js     # Page content script (redaction logic)
        └── popup.js       # Popup logic (settings, messaging)
```

## Technologies

- **Manifest V3** — Latest Chrome extension API
- **Vanilla JavaScript** — No external dependencies
- **CSS3** — Modern styling with soft dark theme

## Permissions

This extension requests **minimal permissions** and follows a privacy-respecting approach:

- `activeTab` — Access only the current tab, and only after you interact with the extension
- `scripting` — Dynamically inject scripts when you activate the extension (no automatic injection)
- `storage` — Save your toggle preference locally

> **Note:** Unlike many extensions, Soft Blackout does NOT inject any scripts automatically. It only runs when you explicitly click a button in the popup.

## What's New in v1.1.0

- **Smart Redact Settings Modal** — Full customization for redaction
- **Redaction Modes** — Poetry, Privacy, and Random modes
- **Intensity Presets** — Quick selection with Light/Medium/Heavy buttons
- **Keep Visible Filters** — Control what stays visible during redaction
- **Undo/Redo System** — Full history support (up to 50 actions)
- **Improved Blackout All** — Now includes links for complete page redaction
- **Double-click to Reveal** — Quick un-redaction of individual words
- **Version Display** — Shows current version in footer

## Design

Minimal icon design featuring a black redaction bar on a cream background, representing the core functionality of text redaction.

## Privacy

This extension:
- Does **not** collect any personal data
- Does **not** run automatically on any page
- Only accesses the current tab **after a user gesture**

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

## License

MIT License — Feel free to use and modify.

---

<p align="center">
  Thanks for your support! ❤️
</p>
