importScripts("../shared/defaults.js", "../shared/settings.js");

const defaults = globalThis.WatchDashDefaults;
const settingsTools = globalThis.WatchDashSettings;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get([defaults.storageKey], (result) => {
    if (chrome.runtime.lastError) {
      console.warn("WatchDash could not load settings:", chrome.runtime.lastError.message);
      return;
    }

    const storedSettings = result[defaults.storageKey];

    if (settingsTools.needsStorageMigration(storedSettings)) {
      chrome.storage.sync.set({
        [defaults.storageKey]: settingsTools.toStorageValue(storedSettings)
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn("WatchDash could not initialize settings:", chrome.runtime.lastError.message);
        }
      });
    }
  });
});

chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      return;
    }

    chrome.tabs.sendMessage(tab.id, {
      type: "watch-dash:command",
      command
    }, () => {
      // Most tabs do not have the content script. Reading lastError suppresses
      // expected "receiving end does not exist" noise for global commands.
      if (chrome.runtime.lastError) {
        return;
      }
    });
  });
});
