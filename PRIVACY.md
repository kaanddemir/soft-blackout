# Privacy Policy

**Last Updated:** January 21, 2026

## Soft Blackout Chrome Extension

### Overview

Soft Blackout is a browser extension that allows users to selectively redact text on web pages. We are committed to protecting your privacy and follow a **user-initiated** approach — the extension only runs when you explicitly interact with it.

### Data Collection

**We do not collect any personal data.**

This extension:
- Does NOT collect personal information
- Does NOT track your browsing history
- Does NOT send any data to external servers
- Does NOT use analytics or tracking tools
- Does NOT run automatically on any page

### Data Storage

The extension uses Chrome's local storage API (`chrome.storage.local`) solely to:
- Save your redaction mode preference (on/off toggle state)

This data is stored **locally on your device only** and is never transmitted anywhere.

### How It Works

- The extension **does not inject any scripts automatically** into web pages
- Scripts are only injected **after you click** a button or toggle in the popup
- The extension only accesses the **currently active tab** after a user gesture
- No broad host permissions or `<all_urls>` access is requested

### Permissions

The extension requests **minimal permissions**:

| Permission | Purpose |
|------------|---------|
| `activeTab` | Access only the current tab, and only after you interact with the extension |
| `scripting` | Dynamically inject the redaction functionality when you activate it |
| `storage` | Remember your toggle preference locally |

### Third-Party Services

This extension does not use any third-party services, APIs, or analytics.

### Changes to This Policy

If we make changes to this privacy policy, we will update the "Last Updated" date above.

### Contact

If you have any questions about this privacy policy, please open an issue on our GitHub repository.

---

**Summary:** Soft Blackout works entirely offline and locally. It only runs when you explicitly use it, and your data never leaves your device.
