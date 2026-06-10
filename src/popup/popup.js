(function watchDashPopup(root) {
  const defaults = root.WatchDashDefaults;
  const settingsTools = root.WatchDashSettings;
  const storageKey = defaults.storageKey;
  const checkboxIds = [
    "enabled",
    "speedControls",
    "skipIntros",
    "skipRecaps",
    "skipCredits",
    "autoNextEpisode",
    "continuePlaying",
    "youtubeQualityControls",
    "youtubeAdSpeedup",
    "youtubeAutoSkipAds",
    "qualityDiagnostics",
    "hotkeys"
  ];
  const qualityTargets = settingsTools.qualityTargets;
  const defaultActionLabels = Object.freeze({
    skipIntros: "Intros",
    skipRecaps: "Recaps",
    skipCredits: "Credits",
    autoNextEpisode: "Next Episode",
    continuePlaying: "Continue"
  });
  const contentScriptFiles = Object.freeze([
    "src/shared/defaults.js",
    "src/shared/settings.js",
    "src/content/platforms.js",
    "src/content/media.js",
    "src/content/automation.js",
    "src/content/youtube-controller.js",
    "src/content/watch-dash.js"
  ]);
  const storageWriteDelayMs = 500;

  let settings = settingsTools.normalize();
  let activeTab = null;
  let activePlaybackSettingsUrl = null;
  let pendingStoredSettings = null;
  let settingsPersistTimer = null;

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    collectElements();
    wireEvents();
    loadSettings();
    root.setInterval(refreshStatus, 1000);
  }

  function collectElements() {
    for (const id of checkboxIds) {
      elements[id] = document.getElementById(id);
    }

    for (const id of [
      "platform",
      "speed",
      "speedBadge",
      "speedNumber",
      "speedStep",
      "qualityTarget",
      "qualityTargetLabel",
      "youtubePanel",
      "youtubeAdState",
      "youtubeAdSpeedState",
      "youtubeQualityState",
      "decrease",
      "increase",
      "reset",
      "openQuality",
      "resolution",
      "frames",
      "lastAction",
      "enableSite"
    ]) {
      elements[id] = document.getElementById(id);
    }
  }

  function wireEvents() {
    for (const id of checkboxIds) {
      elements[id].addEventListener("change", () => {
        updateSettings({ [id]: elements[id].checked });
      });
    }

    elements.speed.addEventListener("input", () => {
      updateSettings({ targetSpeed: Number(elements.speed.value) });
    });
    elements.speed.addEventListener("change", flushSettingsPersist);

    elements.speedNumber.addEventListener("change", () => {
      updateSettings({ targetSpeed: Number(elements.speedNumber.value) });
      flushSettingsPersist();
    });

    elements.speedStep.addEventListener("change", () => {
      updateSettings({ speedStep: Number(elements.speedStep.value) });
      flushSettingsPersist();
    });

    elements.qualityTarget.addEventListener("input", () => {
      const index = Number(elements.qualityTarget.value);
      updateSettings({ qualityTargetHeight: qualityTargets[index] || 1080 });
    });
    elements.qualityTarget.addEventListener("change", flushSettingsPersist);

    elements.decrease.addEventListener("click", () => {
      updateSettings({ targetSpeed: settings.targetSpeed - settings.speedStep });
    });

    elements.increase.addEventListener("click", () => {
      updateSettings({ targetSpeed: settings.targetSpeed + settings.speedStep });
    });

    elements.reset.addEventListener("click", () => {
      updateSettings({ targetSpeed: 1 });
      flushSettingsPersist();
    });

    elements.openQuality.addEventListener("click", () => {
      if (!activePlaybackSettingsUrl) {
        return;
      }

      const url = activePlaybackSettingsUrl;
      const api = extensionApis();
      if (api) {
        api.tabs.create({ url });
      } else {
        root.open(url, "_blank", "noopener");
      }
    });

    for (const button of document.querySelectorAll("[data-speed]")) {
      button.addEventListener("click", () => {
        updateSettings({ targetSpeed: Number(button.dataset.speed) });
        flushSettingsPersist();
      });
    }

    elements.enableSite.addEventListener("click", enableSiteAccess);
    root.addEventListener("pagehide", flushSettingsPersist);
  }

  function loadSettings() {
    const api = extensionApis();
    if (!api) {
      renderSettings();
      renderDisconnected();
      return;
    }

    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      activeTab = tabs[0] || null;

      api.storage.sync.get([storageKey], (result) => {
        if (api.runtime.lastError) {
          console.warn("WatchDash could not load settings:", api.runtime.lastError.message);
          renderSettings();
          refreshStatus();
          return;
        }

        const storedSettings = result[storageKey];
        settings = settingsTools.normalize(storedSettings);

        if (settingsTools.needsStorageMigration(storedSettings)) {
          writeSettingsToStorage(settings);
        }

        renderSettings();
        refreshStatus();
      });
    });
  }

  function updateSettings(partial) {
    const api = extensionApis();
    settings = settingsTools.normalize(Object.assign({}, settings, partial));
    renderSettings();

    if (api) {
      scheduleSettingsPersist();
      sendToActiveTab({ type: "watch-dash:set-settings", settings }, refreshFromResponse);
    }
  }

  function scheduleSettingsPersist() {
    pendingStoredSettings = settings;

    if (settingsPersistTimer) {
      root.clearTimeout(settingsPersistTimer);
    }

    settingsPersistTimer = root.setTimeout(() => {
      settingsPersistTimer = null;
      flushSettingsPersist();
    }, storageWriteDelayMs);
  }

  function flushSettingsPersist() {
    if (!pendingStoredSettings) {
      return;
    }

    const nextSettings = pendingStoredSettings;
    pendingStoredSettings = null;
    writeSettingsToStorage(nextSettings);
  }

  function writeSettingsToStorage(nextSettings) {
    const api = extensionApis();
    if (!api) {
      return;
    }

    api.storage.sync.set({
      [storageKey]: settingsTools.toStorageValue(nextSettings)
    }, () => {
      if (api.runtime.lastError) {
        console.warn("WatchDash could not save settings:", api.runtime.lastError.message);
      }
    });
  }

  function renderSettings() {
    for (const id of checkboxIds) {
      elements[id].checked = Boolean(settings[id]);
    }

    elements.speed.min = settings.minSpeed;
    elements.speed.max = settings.maxSpeed;
    elements.speed.value = settings.targetSpeed;
    elements.speedNumber.min = settings.minSpeed;
    elements.speedNumber.max = settings.maxSpeed;
    elements.speedNumber.value = settings.targetSpeed.toFixed(2);
    elements.speedBadge.textContent = `${settings.targetSpeed.toFixed(2)}x`;
    elements.speedStep.value = settings.speedStep.toFixed(2);
    elements.qualityTarget.value = settingsTools.qualityTargetIndex(settings.qualityTargetHeight);
    elements.qualityTargetLabel.textContent = settingsTools.qualityTargetText(settings.qualityTargetHeight);
    renderRangeFill(elements.speed);
    renderRangeFill(elements.qualityTarget);

    for (const button of document.querySelectorAll("[data-speed]")) {
      const speed = Number(button.dataset.speed);
      const selected = Math.abs(speed - settings.targetSpeed) < 0.001;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }

  function renderRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const percent = Number.isFinite(min) && Number.isFinite(max) && max > min ?
      ((value - min) / (max - min)) * 100 :
      0;
    const clamped = Math.min(100, Math.max(0, percent));
    input.style.setProperty("--range-fill", `${clamped.toFixed(2)}%`);
  }

  function refreshStatus() {
    sendToActiveTab({ type: "watch-dash:get-status" }, refreshFromResponse);
  }

  function sendToActiveTab(message, callback) {
    const api = extensionApis();
    if (!api || !activeTab || !activeTab.id) {
      renderDisconnected();
      return;
    }

    api.tabs.sendMessage(activeTab.id, message, (response) => {
      if (api.runtime.lastError || !response || !response.ok) {
        renderDisconnected();
        return;
      }

      callback(response);
    });
  }

  function refreshFromResponse(response) {
    if (response.settings) {
      settings = settingsTools.normalize(response.settings);
      renderSettings();
    }

    renderStatus(response.status);
  }

  function renderDisconnected() {
    activePlaybackSettingsUrl = null;
    elements.platform.textContent = "Open a supported streaming tab";
    renderPlaybackSettingsButton(null);
    renderServiceMenus(null);
    renderSiteAccessButton();
    elements.resolution.textContent = "Resolution: unavailable";
    elements.frames.textContent = "Frames: unavailable";
    elements.lastAction.textContent = "Last action: none";
  }

  function renderStatus(status) {
    if (!status) {
      renderDisconnected();
      return;
    }

    const speed = Number.isFinite(status.activeSpeed) ? status.activeSpeed : status.targetSpeed;
    activePlaybackSettingsUrl = status.playbackSettingsUrl || null;
    elements.platform.textContent = `${status.platformLabel} - ${Number(speed).toFixed(2)}x`;
    renderPlaybackSettingsButton(status);
    renderServiceMenus(status);
    elements.enableSite.hidden = true;

    if (status.videoWidth && status.videoHeight) {
      const targetText = settingsTools.qualityTargetText(status.qualityTargetHeight || settings.qualityTargetHeight);
      const targetState = status.qualityTargetMet === true ? "met" : "below target";
      elements.resolution.textContent = `Resolution: ${status.videoWidth}x${status.videoHeight} (${targetState}, target ${targetText})`;
    } else {
      elements.resolution.textContent = `Resolution: unavailable (target ${settingsTools.qualityTargetText(settings.qualityTargetHeight)})`;
    }

    if (Number.isFinite(status.droppedVideoFrames) && Number.isFinite(status.totalVideoFrames)) {
      elements.frames.textContent = `Frames: ${status.droppedVideoFrames} dropped / ${status.totalVideoFrames} total`;
    } else {
      elements.frames.textContent = "Frames: unavailable";
    }

    elements.lastAction.textContent = status.lastAction ? `Last action: ${status.lastAction}` : "Last action: none";
  }

  function renderPlaybackSettingsButton(status) {
    const hasSettingsUrl = Boolean(activePlaybackSettingsUrl);
    elements.openQuality.disabled = !hasSettingsUrl;
    elements.openQuality.textContent = hasSettingsUrl && status && status.platformLabel ?
      `${status.platformLabel} Playback Settings` :
      "Playback Settings Unavailable";
  }

  function renderSiteAccessButton() {
    const api = extensionApis();
    const pattern = activeTabOriginPattern();
    const canRequest = Boolean(pattern && activeTab && activeTab.id && api && api.permissions && api.scripting);

    elements.enableSite.hidden = !canRequest;
    elements.enableSite.disabled = false;
    elements.enableSite.textContent = "Enable on This Site";
  }

  function enableSiteAccess() {
    const api = extensionApis();
    const pattern = activeTabOriginPattern();

    if (!api || !api.permissions || !api.scripting || !activeTab || !activeTab.id || !pattern) {
      return;
    }

    elements.enableSite.disabled = true;
    api.permissions.request({ origins: [pattern] }, (granted) => {
      if (api.runtime.lastError) {
        console.warn("WatchDash could not request site access:", api.runtime.lastError.message);
        renderSiteAccessButton();
        return;
      }

      if (!granted) {
        renderSiteAccessButton();
        return;
      }

      registerSiteContentScript(api, pattern, () => {
        injectContentScript(api, () => {
          elements.enableSite.disabled = false;
          refreshStatus();
        });
      });
    });
  }

  function registerSiteContentScript(api, pattern, callback) {
    const id = contentScriptIdForPattern(pattern);
    const script = {
      id,
      matches: [pattern],
      js: Array.from(contentScriptFiles),
      runAt: "document_idle",
      persistAcrossSessions: true
    };

    api.scripting.unregisterContentScripts({ ids: [id] }, () => {
      if (api.runtime.lastError) {
        // It is fine if this origin has not been registered before.
      }

      api.scripting.registerContentScripts([script], () => {
        if (api.runtime.lastError) {
          console.warn("WatchDash could not register this site:", api.runtime.lastError.message);
        }

        callback();
      });
    });
  }

  function injectContentScript(api, callback) {
    api.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: Array.from(contentScriptFiles)
    }, () => {
      if (api.runtime.lastError) {
        console.warn("WatchDash could not inject this site:", api.runtime.lastError.message);
      }

      callback();
    });
  }

  function activeTabOriginPattern() {
    if (!activeTab || !activeTab.url) {
      return null;
    }

    try {
      const url = new URL(activeTab.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }

      return `${url.origin}/*`;
    } catch (error) {
      return null;
    }
  }

  function contentScriptIdForPattern(pattern) {
    return `watchdash_${String(pattern).replace(/[^a-z0-9_]/gi, "_").slice(0, 80)}`;
  }

  function renderServiceMenus(status) {
    const actionControls = status && Array.isArray(status.actionControls) ? status.actionControls : [];
    const actionSettings = new Set(actionControls.length > 0 ?
      actionControls.map((control) => control.setting) :
      status && Array.isArray(status.actionSettings) ? status.actionSettings : []);
    const actionLabels = new Map(actionControls.map((control) => [control.setting, control.label]));
    const actionTiles = Array.from(document.querySelectorAll("[data-action-setting]"));

    for (const tile of actionTiles) {
      const setting = tile.dataset.actionSetting;
      const title = tile.querySelector(".tile-title");
      tile.hidden = !status || !actionSettings.has(setting);

      if (title) {
        title.textContent = shortActionLabel(setting, actionLabels.get(setting));
      }
    }

    const isYouTube = Boolean(status && status.platform === "youtube");
    elements.youtubePanel.hidden = !isYouTube;

    if (!isYouTube) {
      return;
    }

    elements.youtubeAdState.textContent = status.youtubeAdShowing ? "Ad" : "Ready";
    elements.youtubeAdSpeedState.textContent = `Ad speed: ${settings.youtubeAdSpeed.toFixed(2)}x`;
    elements.youtubeQualityState.textContent = youtubeQualityText(status.youtubeQuality);
  }

  function shortActionLabel(setting, label) {
    const fallback = defaultActionLabels[setting] || label || setting;
    const text = String(label || fallback);

    if (setting === "autoNextEpisode" && /video/i.test(text)) {
      return "Next Video";
    }

    if (setting === "autoNextEpisode") {
      return "Next Episode";
    }

    if (setting === "continuePlaying") {
      return "Continue";
    }

    if (setting === "skipIntros") {
      return "Intros";
    }

    if (setting === "skipRecaps") {
      return "Recaps";
    }

    if (setting === "skipCredits") {
      return "Credits";
    }

    return text;
  }

  function youtubeQualityText(quality) {
    if (!quality) {
      return "Quality: pending";
    }

    if (quality.error === "bridge-timeout") {
      return "Quality: bridge unavailable";
    }

    const current = quality.currentLevel || "unknown";
    const target = quality.targetLevel || "auto";
    return `Quality: ${current} / ${target}`;
  }

  function extensionApis() {
    const api = root.chrome;
    if (!api || !api.tabs || !api.storage || !api.storage.sync || !api.runtime) {
      return null;
    }

    return api;
  }
})(globalThis);
