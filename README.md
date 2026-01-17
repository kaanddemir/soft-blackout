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
- **Auto Redact** — Automatically create redaction patterns on any page
- **Blackout All** — Redact entire page content with one click
- **Reset** — Easily restore the original page content
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
   - Toggle **Manual Mode** to select and redact text by clicking
   - Click **Redact Page** for automatic redaction
   - Click **Blackout All** to redact everything
3. Click **Reset** to restore the original page

## Project Structure

```
Soft Blackout/
├── manifest.json          # Extension configuration
├── popup.html             # Popup UI
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
        ├── content.js     # Page content script
        └── popup.js       # Popup logic
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
  Made with care
</p>
