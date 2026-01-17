// Track if content script is injected in the current tab
let isInjected = false;

// Ensure content script and styles are injected
async function ensureContentScriptInjected() {
  if (isInjected) return true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      console.error("No active tab found");
      return false;
    }

    // Check if we can inject into this tab (some pages like chrome:// are restricted)
    if (tab.url?.startsWith('chrome://') ||
      tab.url?.startsWith('chrome-extension://') ||
      tab.url?.startsWith('about:')) {
      console.log("Cannot inject into restricted page:", tab.url);
      showStatus("Cannot run on this page", true);
      return false;
    }

    // Inject CSS first
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['src/css/styles.css']
    });

    // Then inject the content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/js/content.js']
    });

    isInjected = true;
    console.log("Content script and styles injected successfully");
    return true;
  } catch (error) {
    console.error("Failed to inject content script:", error);
    showStatus("Reload page and try again", true);
    return false;
  }
}

// Helper to show status messages
function showStatus(message, isError = false) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.style.color = isError ? "#ff6b6b" : "#ffffff";
}

// Send message to content script with injection check
async function sendMessageToTab(message) {
  const injected = await ensureContentScriptInjected();
  if (!injected) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, message);
      showStatus("", false);
    } catch (error) {
      console.error("Message failed:", error);
      // Try re-injecting and sending again
      isInjected = false;
      const reinjected = await ensureContentScriptInjected();
      if (reinjected) {
        try {
          await chrome.tabs.sendMessage(tab.id, message);
        } catch (e) {
          showStatus("Reload page and try again", true);
        }
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleRedaction');
  const status = document.getElementById('status');

  // Load saved state
  chrome.storage.local.get(['redactionMode'], (result) => {
    if (result.redactionMode) {
      toggle.checked = true;
    }
  });

  // Toggle change handler - inject on first interaction
  toggle.addEventListener('change', async () => {
    const isEnabled = toggle.checked;

    // Save state
    chrome.storage.local.set({ redactionMode: isEnabled });

    // Inject and send message
    await sendMessageToTab({
      action: "toggleRedaction",
      enabled: isEnabled
    });
  });

  // Auto Redact Button
  const autoBtn = document.getElementById('autoRedactBtn');
  autoBtn.addEventListener('click', async () => {
    await sendMessageToTab({ action: "autoRedact" });
  });

  // Blackout All Button
  const blackoutAllBtn = document.getElementById('blackoutAllBtn');
  blackoutAllBtn.addEventListener('click', async () => {
    await sendMessageToTab({ action: "redactAll" });
  });

  // Reset Button
  const resetBtn = document.getElementById('resetRedactBtn');
  resetBtn.addEventListener('click', async () => {
    await sendMessageToTab({ action: "reset" });
  });
});
