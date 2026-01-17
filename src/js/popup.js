document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleRedaction');
  const status = document.getElementById('status');

  // Load saved state
  chrome.storage.local.get(['redactionMode'], (result) => {
    if (result.redactionMode) {
      toggle.checked = true;
      // status.textContent = "Redaction Mode: ON";
    }
  });

  // Listen for changes
  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    // status.textContent = isEnabled ? "Redaction Mode: ON" : "Redaction Mode: OFF";

    // Save state
    chrome.storage.local.set({ redactionMode: isEnabled });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "toggleRedaction",
          enabled: isEnabled
        }, () => {
          if (chrome.runtime.lastError) {
            console.log("Communication error:", chrome.runtime.lastError);
            status.textContent = "Reload Page Required!";
            status.style.color = "#ff6b6b"; // (Handled by CSS now)
          } else {
            status.style.color = "#ffffff";
          }
        });
      }
    });
  });

  // Auto Redact Button
  const autoBtn = document.getElementById('autoRedactBtn');
  autoBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "autoRedact" });
      }
    });
  });

  // Blackout All Button
  const blackoutAllBtn = document.getElementById('blackoutAllBtn');
  blackoutAllBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "redactAll" });
      }
    });
  });

  // Reset Button
  const resetBtn = document.getElementById('resetRedactBtn');
  resetBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "reset" });
      }
    });
  });
});
