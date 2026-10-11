# Soft Blackout Privacy Policy

Last updated: October 11, 2026

Soft Blackout is a Chrome extension that visually masks text on the page you are viewing with three modes: **Manual**, **Poetry** and **Pattern Mask**. Page processing happens locally in your browser.

## Summary

- Soft Blackout makes no network requests. It has no servers, analytics, advertising, telemetry or tracking code.
- Nothing Soft Blackout processes is sent to the developer or to any third party.
- Soft Blackout runs on a tab only after you use it there.
- Page text, your selections, kept words, detected matches, URLs and mask history are never stored.
- Only your settings are saved, on this device.

## Visual masking is not redaction

Soft Blackout draws masks over text on screen. The original text stays in the page, where the website, copy and paste, screen readers, browser developer tools and other extensions can still read it. Do not rely on Soft Blackout to remove confidential information from a page, and check any screenshot before sharing it.

## What Soft Blackout processes

**Page text.** When you use Soft Blackout on a page, its runtime reads the text you select (Manual and Poetry) or the text in the page's reading blocks (Pattern Mask scan) to place masks. Pattern Mask looks for email addresses, URLs and phone numbers in that text; the matches are only counted and masked, never saved.

**Temporary state.** Masks, Undo and Redo history, a Poetry draft and pending scan results are kept only in the page's memory. They are discarded when the page is reloaded, navigated away from or closed, or when you choose **Reset page**.

## Where data is kept

| Data | Where | Removed when |
| --- | --- | --- |
| Theme, last selected mode, Mask on select, pattern categories, mask style and colour | `chrome.storage.local` on this device | Soft Blackout is uninstalled |
| Masks, history, Poetry drafts and scan results | Memory of the page's Soft Blackout runtime | The page is reloaded, navigated away from or closed, or you choose **Reset page** |

Settings are not synced to other devices. The page runtime reads the theme and Mask on select settings only so its on-page controls match the popup.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Access the current tab, only after you use Soft Blackout there |
| `scripting` | Load the masking runtime into that tab |
| `storage` | Save your settings on this device |

Soft Blackout requests no host permissions, has no background service worker and no content scripts that run automatically. It cannot run on Chrome's own pages, the Chrome Web Store or local files.

## Network and external services

Soft Blackout does not use cookies, remote code, artificial intelligence services or any other external service, and it does not evaluate generated code. Processing everything locally avoids sending page content anywhere, but it does not remove browser, website, device or extension risks. Chrome itself may handle installation and updates under Google's policies.

## Sharing

Soft Blackout does not transmit, sell or share any data. The developer never receives it.

Soft Blackout's use of information received through Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Data is used only to provide the masking features described here.

## Your control

- Masks are created only when you choose **Mask**, **Apply composition** or **Apply masks**.
- **Undo**, **Redo** and **Reset page** change or remove masks at any time.
- Reloading or leaving the page removes all of Soft Blackout's masks and temporary state from it.
- Uninstalling Soft Blackout removes the extension and its storage.

## Changes and contact

Changes to this policy will be published in this file with an updated date and noted in the [Changelog](CHANGELOG.md). Questions can be sent to [heykaan.dev@gmail.com](mailto:heykaan.dev@gmail.com) or raised on the project's GitHub issue tracker: <https://github.com/kaanddemir/soft-blackout/issues>.

---

Built by [heykaan.dev](https://heykaan.dev)
