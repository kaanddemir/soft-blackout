// Get current tab ID
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Check if content script is already injected by sending a ping
async function isContentScriptInjected(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return response && response.pong === true;
  } catch (error) {
    return false;
  }
}

// Ensure content script and styles are injected
async function ensureContentScriptInjected() {
  try {
    const tab = await getCurrentTab();

    if (!tab || !tab.id) {
      console.error("No active tab found");
      return false;
    }

    // Check if we can inject into this tab (some pages like chrome:// are restricted)
    if (tab.url?.startsWith('chrome://') ||
      tab.url?.startsWith('chrome-extension://') ||
      tab.url?.startsWith('about:') ||
      tab.url?.startsWith('edge://') ||
      tab.url?.startsWith('file://')) {
      console.log("Cannot inject into restricted page:", tab.url);
      showStatus("Cannot run on this page", true);
      return false;
    }

    // Check if already injected using ping mechanism
    const alreadyInjected = await isContentScriptInjected(tab.id);
    if (alreadyInjected) {
      console.log("Content script already injected");
      return true;
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
  if (!injected) return false;

  const tab = await getCurrentTab();
  if (tab && tab.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message);
      showStatus("", false);
      return response;
    } catch (error) {
      console.error("Message failed:", error);
      showStatus("Reload page and try again", true);
      return false;
    }
  }
  return false;
}

// Get storage key for tab-specific state
function getTabStateKey(tabId) {
  return `redactionMode_tab_${tabId}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('toggleRedaction');
  const status = document.getElementById('status');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');

  const tab = await getCurrentTab();
  const tabId = tab?.id;

  if (!tabId) {
    showStatus("Cannot access tab", true);
    return;
  }

  // Update undo/redo button states based on history
  function updateHistoryButtons(canUndo, canRedo) {
    if (undoBtn) {
      undoBtn.disabled = !canUndo;
    }
    if (redoBtn) {
      redoBtn.disabled = !canRedo;
    }
  }

  // Extended sendMessage that updates history buttons
  async function sendMessageWithHistoryUpdate(message) {
    const response = await sendMessageToTab(message);
    if (response && typeof response.canUndo !== 'undefined') {
      updateHistoryButtons(response.canUndo, response.canRedo);
    }
    return response;
  }

  // Storage key for this tab's toggle state
  const stateKey = getTabStateKey(tabId);

  // Check if content script is already injected (means page wasn't refreshed)
  const isAlreadyInjected = await isContentScriptInjected(tabId);

  if (isAlreadyInjected) {
    // Content script exists - load saved state
    chrome.storage.local.get([stateKey], (result) => {
      if (result[stateKey]) {
        toggle.checked = true;
      }
    });

    // Get initial history status
    const initialResponse = await sendMessageToTab({ action: "getHistoryStatus" });
    if (initialResponse) {
      updateHistoryButtons(initialResponse.canUndo, initialResponse.canRedo);
    }
  } else {
    // Content script not injected = page was refreshed or new page
    // Reset toggle state for this tab
    toggle.checked = false;
    chrome.storage.local.set({ [stateKey]: false });
  }

  // Toggle change handler - inject on first interaction
  toggle.addEventListener('change', async () => {
    const isEnabled = toggle.checked;

    // Save state for this specific tab
    chrome.storage.local.set({ [stateKey]: isEnabled });

    // Inject and send message
    await sendMessageWithHistoryUpdate({
      action: "toggleRedaction",
      enabled: isEnabled
    });
  });

  // ==================== SETTINGS MODAL ====================
  const settingsModal = document.getElementById('settingsModal');
  const settingsBtn = document.getElementById('settingsBtn');
  const closeModal = document.getElementById('closeModal');
  const intensitySlider = document.getElementById('intensitySlider');
  const intensityValue = document.getElementById('intensityValue');
  const modeBtns = document.querySelectorAll('.mode-btn');

  // Current settings state
  let currentMode = 'poetry';

  // Open modal
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('active');
  });

  // Close modal
  closeModal.addEventListener('click', () => {
    settingsModal.classList.remove('active');
  });

  // Close on backdrop click
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.remove('active');
    }
  });

  // Intensity slider update
  const presetBtns = document.querySelectorAll('.preset-btn');

  // Update preset button active states based on slider value
  function updatePresetButtons(value) {
    presetBtns.forEach(btn => {
      const presetValue = parseInt(btn.dataset.value);
      // Mark as active if slider is within ±10 of preset value
      if (Math.abs(value - presetValue) <= 10) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  intensitySlider.addEventListener('input', () => {
    intensityValue.textContent = `${intensitySlider.value}%`;
    updatePresetButtons(parseInt(intensitySlider.value));
  });

  // Preset buttons click handler
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value;
      intensitySlider.value = value;
      intensityValue.textContent = `${value}%`;
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Checkbox elements
  const keepProperNouns = document.getElementById('keepProperNouns');
  const keepLongWords = document.getElementById('keepLongWords');
  const keepNumbers = document.getElementById('keepNumbers');

  // Mode presets for checkboxes
  const modePresets = {
    poetry: { properNouns: true, longWords: true, numbers: false },
    privacy: { properNouns: false, longWords: true, numbers: false }, // Hide sensitive data
    random: { properNouns: false, longWords: false, numbers: false }  // Pure random
  };

  // Mode selection - updates checkboxes based on mode
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;

      // Update checkboxes based on mode preset
      const preset = modePresets[currentMode];
      if (preset) {
        keepProperNouns.checked = preset.properNouns;
        keepLongWords.checked = preset.longWords;
        keepNumbers.checked = preset.numbers;
      }
    });
  });

  // Get all settings
  function getRedactionSettings() {
    return {
      intensity: parseInt(intensitySlider.value) / 100,
      mode: currentMode,
      keepProperNouns: keepProperNouns.checked,
      keepLongWords: keepLongWords.checked,
      keepNumbers: keepNumbers.checked
    };
  }

  // Auto Redact Button - sends all settings
  const autoBtn = document.getElementById('autoRedactBtn');
  autoBtn.addEventListener('click', async () => {
    const settings = getRedactionSettings();
    await sendMessageWithHistoryUpdate({
      action: "autoRedact",
      ...settings
    });
  });

  // Modal Redact Page Button - same as above but closes modal
  const modalRedactBtn = document.getElementById('modalRedactBtn');
  modalRedactBtn.addEventListener('click', async () => {
    const settings = getRedactionSettings();
    settingsModal.classList.remove('active'); // Close modal first
    await sendMessageWithHistoryUpdate({
      action: "autoRedact",
      ...settings
    });
  });

  // Blackout All Button
  const blackoutAllBtn = document.getElementById('blackoutAllBtn');
  blackoutAllBtn.addEventListener('click', async () => {
    await sendMessageWithHistoryUpdate({ action: "redactAll" });
  });

  // Reset Button
  const resetBtn = document.getElementById('resetRedactBtn');
  resetBtn.addEventListener('click', async () => {
    await sendMessageWithHistoryUpdate({ action: "reset" });
    // Also reset toggle state for this tab
    toggle.checked = false;
    chrome.storage.local.set({ [stateKey]: false });
  });

  // Undo Button
  undoBtn.addEventListener('click', async () => {
    const response = await sendMessageWithHistoryUpdate({ action: "undo" });
    if (response && !response.success) {
      showStatus(response.message || "Cannot undo", true);
    }
  });

  // Redo Button
  redoBtn.addEventListener('click', async () => {
    const response = await sendMessageWithHistoryUpdate({ action: "redo" });
    if (response && !response.success) {
      showStatus(response.message || "Cannot redo", true);
    }
  });

  // Clean up old tab states periodically (optional - keeps storage clean)
  cleanupOldTabStates();

  // Display version number from manifest
  const manifestData = chrome.runtime.getManifest();
  const versionLabel = document.getElementById('versionLabel');
  if (versionLabel) {
    versionLabel.textContent = `v${manifestData.version}`;
  }
});

// Clean up states for tabs that no longer exist
async function cleanupOldTabStates() {
  try {
    const allTabs = await chrome.tabs.query({});
    const activeTabIds = new Set(allTabs.map(t => t.id));

    const allStorage = await chrome.storage.local.get(null);
    const keysToRemove = [];

    for (const key of Object.keys(allStorage)) {
      if (key.startsWith('redactionMode_tab_')) {
        const tabId = parseInt(key.replace('redactionMode_tab_', ''));
        if (!activeTabIds.has(tabId)) {
          keysToRemove.push(key);
        }
      }
    }

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`Cleaned up ${keysToRemove.length} old tab states`);
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}
