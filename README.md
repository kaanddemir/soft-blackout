# Soft Blackout

<div align="center">
  <img src="icons/icon128.png" alt="Soft Blackout Logo" width="128" height="128">
</div>

Lightweight, privacy-first redaction tools for any web page.

## Overview
Soft Blackout is a Chrome Extension designed to help you hide private information or remove distractions from any web page. Whether you need to obscure personal data before taking a screenshot, focus on reading without clutter, or create blackout poetry, Soft Blackout provides the tools to do it securely and locally. It runs only when you want it to, keeping your browsing experience fast and private.

## Features
- **Quick Redaction**: Automatically redact text using intelligent modes like Poetry, Privacy, and Random.
- **Manual Control**: Click and drag to selectively redact specific sentences or paragraphs.
- **Customizable Intensity**: Adjust redaction levels (Light, Medium, Heavy) to suit your needs.
- **Smart Filters**: Choose to keep proper nouns, long words, or numbers visible while redacting the rest.
- **Blackout All**: A single-click option to completely obscure everything on the page.
- **History Management**: Full Undo and Redo capabilities to experiment fearlessly.
- **Interactive Reveal**: Double-click any redacted area to reveal the text underneath.
- **Turkish Language Support**: Soft Blackout is fully localized in Turkish and automatically detects your browser language.

## How It Works
1. **Activate**: Click the Soft Blackout icon in your browser toolbar.
2. **Choose Mode**:
   - Toggle **Manual Mode** to redact by selecting text with your mouse.
   - Use **Quick Redact** to apply automatic algorithms based on your settings.
3. **Customize**: Click the gear icon to adjust intensity and filters, such as maintaining names or dates.
4. **Interact**: Double-click redacted blocks to peek at the content, or use Undo/Redo to fine-tune the result.

## Localization
Soft Blackout is fully localized in English and Turkish. The extension automatically detects your browser language.

## Use Cases
- **Privacy Protection**: Obscure names, emails, and private information before sharing screen captures.
- **Content Focus**: Black out distractions to focus purely on the text that matters.
- **Creative Writing**: Turn news articles or blog posts into unique pieces of blackout poetry.
- **Testing**: Developers can use it to test UI layouts with variable text visibility.

## Privacy
Soft Blackout is built with a strictly **privacy-first** architecture:
- **Local Execution**: All processing happens locally in your browser. No data is ever sent to a server.
- **No Tracking**: The extension collects absolutely no user data or analytics.
- **On-Demand**: Scripts are only injected when you explicitly activate the extension, preserving your browser's performance and security.
- See our [Privacy Policy](PRIVACY_POLICY.md) for more details.

## Permissions
Soft Blackout requests the minimal permissions it needs to run:
- `activeTab`: Allows the extension to work on the current tab after you activate it.
- `scripting`: Injects the redaction script only when you explicitly use the extension.
- `storage`: Saves extension settings such as mode, intensity, and filters locally in your browser.

## Tech Stack
- **Manifest V3**: Compliant with the latest Chrome Extension standards for security and performance.
- **Vanilla JavaScript**: Lightweight and fast, without heavy frameworks.
- **CSS3**: Modern, aesthetic styling for a seamless user experience.

## Installation

### From Chrome Web Store
[Install Blackout](https://chromewebstore.google.com/detail/soft-blackout/oeefplhfabbdadpicjbgbiapoadppkpo)

### Manual Installation
1. Clone or download this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top right corner.
4. Click **Load unpacked**.
5. Select the `Soft Blackout` directory you just downloaded.

## Project Structure
- `manifest.json`: Chrome Extension manifest and permission configuration.
- `popup.html`: Extension popup interface.
- `src/js/popup.js`: Popup behavior and settings logic.
- `src/js/content.js`: Web page redaction logic.
- `src/css/styles.css`: Extension styling.
- `_locales/en/messages.json`: English localization strings.
- `_locales/tr/messages.json`: Turkish localization strings.
- `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png`: Extension icons.
- `PRIVACY_POLICY.md`: Privacy policy.
- `LICENSE`: MIT License.

## Contributing
Contributions are welcome! If you have ideas for improvements or bug fixes, please feel free to:
1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/Extension`).
3. Commit your changes (`git commit -m 'Add some Extension'`).
4. Push to the branch (`git push origin feature/Extension`).
5. Open a Pull Request.

## License
Distributed under the MIT License. See `LICENSE` for more information.

<br>

<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a></p>
</div>
