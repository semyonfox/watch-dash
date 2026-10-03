(function watchDashPopup(root) {
  const defaults = root.WatchDashDefaults;
  const settingsTools = root.WatchDashSettings;
  const storageKey = defaults.storageKey;
  const qualityTargets = settingsTools.qualityTargets;
  const storageWriteDelayMs = 500;
  const statusPollIntervalMs = 1000;
  const resetDefaultLabel = "Reset Defaults";
  const resetArmedLabel = "Confirm Reset";

  let settings = settingsTools.normalize();
  let activeTab = null;
  let activePlaybackSettingsUrl = null;
  let pendingStoredSettings = null;
  let settingsPersistTimer = null;
  let lastStatusAnnouncement = "";
  let settingInputs = [];
  let resetArmed = false;
  let storageReady = false;
  let pendingSavedCallback = null;
  let settingsRevision = 0;
  let pendingSettingsRevision = null;

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    collectElements();
    wireEvents();
    renderSettings();
    loadSettings();
    if (root.WatchDashTelemetry)
      root.WatchDashTelemetry.onPreference((enabled) => {
        if (enabled) root.WatchDashTelemetry.count("screen_view", "popup");
      });
    root.setInterval(refreshStatus, statusPollIntervalMs);
  }

  function collectElements() {
    settingInputs = Array.from(
      document.querySelectorAll("input[data-setting]"),
    );

    for (const input of settingInputs) {
      elements[input.dataset.setting] = input;
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
      "rateValue",
      "resolutionValue",
      "framesValue",
      "lastActionValue",
      "statusLiveRegion",
      "enableSite",
      "exportButton",
      "importButton",
      "resetDefaultsButton",
      "importExportText",
      "backupStatus",
      "cancelReset",
      "settingsStatus",
      "retrySettings",
      "openSettings",
      "connectionHelp",
      "siteStatus",
    ]) {
      elements[id] = document.getElementById(id);
    }
  }

  function wireEvents() {
    for (const input of settingInputs) {
      input.addEventListener("change", () => {
        updateSettings({ [input.dataset.setting]: input.checked });
      });
    }

    elements.speed.addEventListener("input", () => {
      updateSettings({ targetSpeed: Number(elements.speed.value) });
    });
    elements.speed.addEventListener("change", flushSettingsPersist);

    elements.speedNumber.addEventListener("change", () => {
      if (!validNumber(elements.speedNumber)) return;
      updateSettings({ targetSpeed: Number(elements.speedNumber.value) });
      flushSettingsPersist();
    });

    elements.openSettings.addEventListener("click", () => {
      const api = extensionApis();
      if (api && typeof api.runtime.openOptionsPage === "function")
        api.runtime.openOptionsPage();
    });
    elements.speed.addEventListener("keydown", (event) => {
      if (
        ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)
      ) {
        event.preventDefault();
        updateSettings({
          targetSpeed:
            settings.targetSpeed +
            (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1) *
              settings.speedStep,
        });
        flushSettingsPersist();
      }
    });
    elements.speedStep.addEventListener("change", () => {
      if (!validNumber(elements.speedStep)) return;
      updateSettings({ speedStep: Number(elements.speedStep.value) });
      flushSettingsPersist();
    });

    elements.qualityTarget.addEventListener("input", () => {
      const index = Number(elements.qualityTarget.value);
      updateSettings({ qualityTargetHeight: qualityTargets[index] || 1080 });
    });
    elements.qualityTarget.addEventListener("change", flushSettingsPersist);

    elements.decrease.addEventListener("click", () => {
      updateSettings({
        targetSpeed: settings.targetSpeed - settings.speedStep,
      });
    });

    elements.increase.addEventListener("click", () => {
      updateSettings({
        targetSpeed: settings.targetSpeed + settings.speedStep,
      });
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

    elements.cancelReset.addEventListener("click", () => {
      disarmResetDefaults();
      showBackupStatus("Reset cancelled. Your settings are unchanged.", false);
      elements.resetDefaultsButton.focus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && resetArmed) {
        disarmResetDefaults();
        showBackupStatus("Reset cancelled.", false);
        elements.resetDefaultsButton.focus();
      }
    });
    elements.retrySettings.addEventListener("click", () => {
      if (!storageReady) loadSettings();
      else flushSettingsPersist();
    });
    elements.importExportText.addEventListener("input", () => {
      elements.importExportText.setAttribute("aria-invalid", "false");
    });
    elements.exportButton.addEventListener("click", runExport);
    elements.importButton.addEventListener("click", runImport);
    elements.resetDefaultsButton.addEventListener("click", handleResetDefaults);
    elements.enableSite.addEventListener("click", enableSiteAccess);
    root.addEventListener("pagehide", flushSettingsPersist);
  }

  function loadSettings() {
    setStorageReady(false);
    showSettingsStatus("Loading preferences...", false);
    const api = extensionApis();
    const loadRevision = settingsRevision;
    if (!api) {
      setStorageReady(false);
      showSettingsStatus(
        "Open WatchDash as an extension to load and save preferences.",
        true,
      );
      renderSettings();
      renderDisconnected();
      return;
    }

    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      activeTab = tabs[0] || null;

      api.storage.sync.get([storageKey], (result) => {
        if (api.runtime.lastError) {
          setStorageReady(false);
          showSettingsStatus(
            "Could not load preferences. Retry before changing settings.",
            true,
          );
          reportError("storage_failed");
          renderSettings();
          refreshStatus();
          return;
        }

        if (loadRevision !== settingsRevision) {
          refreshStatus();
          return;
        }

        setStorageReady(true);
        showSettingsStatus(
          "Preferences loaded. Changes save automatically.",
          false,
        );
        const storedSettings = result[storageKey];
        settings = settingsTools.normalize(storedSettings);

        if (settingsTools.needsStorageMigration(storedSettings)) {
          writeSettingsToStorage(settings, () =>
            showBackupStatus("Preferences saved.", false),
          );
        }

        renderSettings();
        refreshStatus();
      });
    });
  }

  function updateSettings(partial) {
    if (!storageReady) return;
    const api = extensionApis();
    settings = settingsTools.normalize(Object.assign({}, settings, partial));
    settingsRevision += 1;
    renderSettings();

    if (api) {
      scheduleSettingsPersist();
      sendSettingsToActiveTab();
    }
  }

  function scheduleSettingsPersist() {
    pendingStoredSettings = settings;
    showSettingsStatus("Saving preferences...", false);

    if (settingsPersistTimer) {
      root.clearTimeout(settingsPersistTimer);
    }

    settingsPersistTimer = root.setTimeout(() => {
      settingsPersistTimer = null;
      flushSettingsPersist();
    }, storageWriteDelayMs);
  }

  function flushSettingsPersist() {
    root.clearTimeout(settingsPersistTimer);
    settingsPersistTimer = null;
    if (!pendingStoredSettings) {
      return;
    }

    const nextSettings = pendingStoredSettings;
    pendingStoredSettings = null;
    writeSettingsToStorage(nextSettings);
  }

  function writeSettingsToStorage(nextSettings, onSaved) {
    root.clearTimeout(settingsPersistTimer);
    settingsPersistTimer = null;
    const api = extensionApis();
    if (!api || !storageReady) return;
    const revision = settingsRevision;
    if (onSaved) pendingSavedCallback = onSaved;
    api.storage.sync.set(
      { [storageKey]: settingsTools.toStorageValue(nextSettings) },
      () => {
        if (revision !== settingsRevision) return;
        if (api.runtime.lastError) {
          pendingStoredSettings = settings;
          showSettingsStatus(
            "Changes are not saved. Retry to keep these preferences.",
            true,
          );
          reportError("storage_failed");
          if (onSaved)
            showBackupStatus("Changes are not saved. Use Retry above.", true);
          return;
        }
        showSettingsStatus("Preferences saved.", false);
        if (pendingSavedCallback) {
          const callback = pendingSavedCallback;
          pendingSavedCallback = null;
          callback();
        }
      },
    );
  }

  function renderSettings() {
    for (const input of settingInputs) {
      input.checked = Boolean(settings[input.dataset.setting]);
    }

    elements.speed.min = settings.minSpeed;
    elements.speed.max = settings.maxSpeed;
    elements.speed.step = "0.01";
    elements.speed.value = settings.targetSpeed;
    elements.speed.setAttribute(
      "aria-valuetext",
      `${settings.targetSpeed.toFixed(2)} times normal speed`,
    );
    elements.speedNumber.min = settings.minSpeed;
    elements.speedNumber.max = settings.maxSpeed;
    elements.speedNumber.step = "0.01";
    elements.speedNumber.value = settings.targetSpeed.toFixed(2);
    elements.speedBadge.textContent = `${settings.targetSpeed.toFixed(2)}x`;
    elements.speedStep.value = settings.speedStep.toFixed(2);
    elements.qualityTarget.value = settingsTools.qualityTargetIndex(
      settings.qualityTargetHeight,
    );
    elements.qualityTarget.setAttribute(
      "aria-valuetext",
      settingsTools.qualityTargetText(settings.qualityTargetHeight),
    );
    elements.qualityTargetLabel.textContent = settingsTools.qualityTargetText(
      settings.qualityTargetHeight,
    );
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
    const percent =
      Number.isFinite(min) && Number.isFinite(max) && max > min
        ? ((value - min) / (max - min)) * 100
        : 0;
    const clamped = Math.min(100, Math.max(0, percent));
    input.style.setProperty("--range-fill", `${clamped.toFixed(2)}%`);
  }

  function refreshStatus() {
    const requestedRevision = settingsRevision;
    const hadPendingSettings = pendingSettingsRevision !== null;
    sendToActiveTab({ type: "watch-dash:get-status" }, (response) => {
      refreshFromResponse(
        response,
        requestedRevision === settingsRevision &&
          !hadPendingSettings &&
          pendingSettingsRevision === null,
      );
    });
  }

  function sendSettingsToActiveTab() {
    const requestedRevision = settingsRevision;
    pendingSettingsRevision = requestedRevision;
    sendToActiveTab(
      { type: "watch-dash:set-settings", settings },
      (response) => {
        if (requestedRevision !== settingsRevision) {
          return;
        }

        pendingSettingsRevision = null;
        refreshFromResponse(response, true);
      },
      () => {
        if (requestedRevision === settingsRevision) {
          pendingSettingsRevision = null;
        }
      },
    );
  }

  function sendToActiveTab(message, callback, onFailure) {
    const api = extensionApis();
    if (!api || !activeTab || !activeTab.id) {
      renderDisconnected();
      if (onFailure) {
        onFailure();
      }
      return;
    }

    api.tabs.sendMessage(activeTab.id, message, (response) => {
      if (api.runtime.lastError || !response || !response.ok) {
        renderDisconnected();
        if (onFailure) {
          onFailure();
        }
        return;
      }

      callback(response);
    });
  }

  function refreshFromResponse(response, applyResponseSettings) {
    if (
      storageReady &&
      applyResponseSettings &&
      response.settings &&
      settingsTools.isSettingsPayload(response.settings)
    ) {
      settings = settingsTools.normalize(response.settings);
      renderSettings();
    }

    renderStatus(response.status);
  }

  function renderDisconnected() {
    activePlaybackSettingsUrl = null;
    document.body.dataset.connected = "false";
    elements.platform.textContent = "No player connected";
    setHidden(elements.connectionHelp, false);
    renderPlaybackSettingsButton(null);
    renderServiceMenus(null);
    renderSiteAccessButton();
    setDiagValue(elements.rateValue, "--", "unknown");
    setDiagValue(elements.resolutionValue, "unavailable", "unknown");
    setDiagValue(elements.framesValue, "unavailable", "unknown");
    setDiagValue(elements.lastActionValue, "none", "unknown");
    announceStatusChange(
      "WatchDash disconnected. Open a supported streaming tab.",
    );
  }

  function renderStatus(status) {
    if (!status) {
      renderDisconnected();
      return;
    }

    const speed = Number.isFinite(status.activeSpeed)
      ? status.activeSpeed
      : status.targetSpeed;
    activePlaybackSettingsUrl = status.playbackSettingsUrl || null;
    document.body.dataset.connected = "true";
    const actual = Number.isFinite(status.activeSpeed);
    const state = settings.enabled
      ? settings.speedControls
        ? ""
        : "Speed control off. "
      : "WatchDash off. ";
    elements.platform.textContent = `${state}${status.platformLabel} · ${actual ? Number(speed).toFixed(2) + "x" : "No active video"}`;
    setHidden(elements.connectionHelp, true);
    renderPlaybackSettingsButton(status);
    renderServiceMenus(status);
    setHidden(elements.enableSite, true);

    setDiagValue(
      elements.rateValue,
      Number.isFinite(status.activeSpeed)
        ? `${Number(speed).toFixed(2)}x`
        : "unavailable",
      Number.isFinite(status.activeSpeed) ? "ok" : "unknown",
    );

    renderResolutionRow(status);
    renderFramesRow(status);

    if (status.lastAction) {
      setDiagValue(elements.lastActionValue, String(status.lastAction), "busy");
    } else {
      setDiagValue(elements.lastActionValue, "none", "unknown");
    }

    announceStatusChange(statusAnnouncementText(status, speed));
  }

  function renderResolutionRow(status) {
    const targetText = settingsTools.qualityTargetText(
      status.qualityTargetHeight || settings.qualityTargetHeight,
    );

    if (status.videoWidth && status.videoHeight) {
      const state = status.qualityTargetMet === true ? "ok" : "warn";
      const suffix =
        status.qualityTargetMet === true
          ? `meets ${targetText}`
          : `below ${targetText}`;
      setDiagValue(
        elements.resolutionValue,
        `${status.videoWidth} x ${status.videoHeight} (${suffix})`,
        state,
      );
      return;
    }

    setDiagValue(
      elements.resolutionValue,
      `unavailable, target ${targetText}`,
      "unknown",
    );
  }

  function renderFramesRow(status) {
    const dropped = status.droppedVideoFrames;
    const total = status.totalVideoFrames;

    if (!Number.isFinite(dropped) || !Number.isFinite(total)) {
      setDiagValue(elements.framesValue, "unavailable", "unknown");
      return;
    }

    setDiagValue(
      elements.framesValue,
      `${dropped} dropped / ${total} total`,
      dropped > 0 ? "warn" : "ok",
    );
  }

  function setDiagValue(element, text, state) {
    element.textContent = text;
    element.dataset.state = state;
  }

  function statusAnnouncementText(status, speed) {
    const parts = [
      `${settings.enabled ? "WatchDash on" : "WatchDash off"}. ${settings.speedControls ? "Speed control on" : "Speed control off"}. ${status.platformLabel}. ${Number.isFinite(status.activeSpeed) ? "Actual speed " + Number(speed).toFixed(2) + "x" : "No measured playback speed"}. Target ${settings.targetSpeed.toFixed(2)}x`,
    ];

    if (status.videoWidth && status.videoHeight) {
      parts.push(`resolution ${status.videoWidth} by ${status.videoHeight}`);
    } else {
      parts.push("resolution unavailable");
    }

    if (status.lastAction) {
      parts.push(`Last action: ${status.lastAction}`);
    }

    if (status.platform === "youtube")
      parts.push(youtubeQualityText(status.youtubeQuality));
    return parts.join(". ");
  }

  function announceStatusChange(message) {
    if (
      !elements.statusLiveRegion ||
      !message ||
      message === lastStatusAnnouncement
    ) {
      return;
    }

    lastStatusAnnouncement = message;
    elements.statusLiveRegion.textContent = message;
  }

  function renderPlaybackSettingsButton(status) {
    const hasSettingsUrl = Boolean(activePlaybackSettingsUrl);
    elements.openQuality.disabled = !hasSettingsUrl;
    elements.openQuality.textContent =
      hasSettingsUrl && status && status.platformLabel
        ? `${status.platformLabel} Playback Settings`
        : "Playback Settings Unavailable";
  }

  function renderSiteAccessButton() {
    const api = extensionApis();
    const pattern = activeTabOriginPattern();
    const canRequest = Boolean(
      pattern &&
      activeTab &&
      activeTab.id &&
      api &&
      api.permissions &&
      api.scripting,
    );

    setHidden(elements.enableSite, !canRequest);
    elements.enableSite.disabled = false;
    elements.enableSite.textContent = "Enable on This Site";
  }

  function enableSiteAccess() {
    const api = extensionApis();
    const pattern = activeTabOriginPattern();

    if (
      !api ||
      !api.permissions ||
      !api.scripting ||
      !activeTab ||
      !activeTab.id ||
      !pattern
    ) {
      return;
    }

    elements.enableSite.disabled = true;
    elements.siteStatus.textContent = "Requesting access to this site...";
    api.permissions.request({ origins: [pattern] }, (granted) => {
      if (api.runtime.lastError) {
        console.warn(
          "WatchDash could not request site access:",
          api.runtime.lastError.message,
        );
        elements.siteStatus.textContent =
          "Could not request access. Try again.";
        reportError("permission_failed");
        renderSiteAccessButton();
        return;
      }

      if (!granted) {
        elements.siteStatus.textContent =
          "Access was not granted. You can try again when ready.";
        renderSiteAccessButton();
        return;
      }

      registerSiteContentScript(api, pattern, (registered) => {
        if (!registered) {
          siteFailure();
          return;
        }
        injectContentScript(api, (injected) => {
          if (!injected) {
            siteFailure();
            return;
          }
          elements.siteStatus.textContent =
            "Access enabled. Start a video on this site.";
          elements.enableSite.disabled = false;
          refreshStatus();
        });
      });
    });
  }

  function registerSiteContentScript(api, pattern, callback) {
    const id = contentScriptIdForPattern(pattern);
    const files = contentScriptFiles(api);

    if (files.length === 0) {
      console.warn("WatchDash could not find its content script bundle.");
      callback(false);
      return;
    }

    const script = {
      id,
      matches: [pattern],
      js: files,
      runAt: "document_idle",
      persistAcrossSessions: true,
    };

    api.scripting.unregisterContentScripts({ ids: [id] }, () => {
      if (api.runtime.lastError) {
        // It is fine if this origin has not been registered before.
      }

      api.scripting.registerContentScripts([script], () => {
        if (api.runtime.lastError) {
          console.warn(
            "WatchDash could not register this site:",
            api.runtime.lastError.message,
          );
        }

        callback(!api.runtime.lastError);
      });
    });
  }

  function injectContentScript(api, callback) {
    const files = contentScriptFiles(api);

    if (files.length === 0) {
      console.warn("WatchDash could not find its content script bundle.");
      callback(false);
      return;
    }

    api.scripting.executeScript(
      {
        target: { tabId: activeTab.id },
        files,
      },
      () => {
        if (api.runtime.lastError) {
          console.warn(
            "WatchDash could not inject this site:",
            api.runtime.lastError.message,
          );
        }

        callback(!api.runtime.lastError);
      },
    );
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
    return `watchdash_${String(pattern)
      .replace(/[^a-z0-9_]/gi, "_")
      .slice(0, 80)}`;
  }

  function renderServiceMenus(status) {
    const actionControls =
      status && Array.isArray(status.actionControls)
        ? status.actionControls
        : [];
    const actionSettings = new Set(
      actionControls.length > 0
        ? actionControls.map((control) => control.setting)
        : status && Array.isArray(status.actionSettings)
          ? status.actionSettings
          : [],
    );
    const actionLabels = new Map(
      actionControls.map((control) => [
        control.setting,
        control.controlLabel || control.label,
      ]),
    );
    const actionTiles = Array.from(
      document.querySelectorAll("[data-action-setting]"),
    );

    for (const tile of actionTiles) {
      const setting = tile.dataset.actionSetting;
      const title = tile.querySelector(".tile-title");
      setHidden(tile, !status || !actionSettings.has(setting));

      if (title) {
        title.textContent = actionLabels.get(setting) || title.textContent;
      }
    }

    const isYouTube = Boolean(status && status.platform === "youtube");
    setHidden(elements.youtubePanel, !isYouTube);

    if (!isYouTube) {
      return;
    }

    elements.youtubeAdState.textContent = status.youtubeAdShowing
      ? "Ad"
      : "Ready";
    elements.youtubeAdSpeedState.textContent = `Ad speed: ${settings.youtubeAdSpeed.toFixed(2)}x`;
    elements.youtubeQualityState.textContent = youtubeQualityText(
      status.youtubeQuality,
    );
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
    return `Quality: current ${current}, target ${target}`;
  }

  function runExport() {
    const exportedText = settingsTools.toExportText(settings);
    elements.importExportText.value = exportedText;
    elements.importExportText.focus();
    elements.importExportText.select();

    copyTextToClipboard(exportedText, (copied) => {
      showBackupStatus(
        copied
          ? "Settings exported to the box and copied to your clipboard."
          : "Settings exported below. Copy them somewhere safe.",
        false,
      );
    });
  }

  function runImport() {
    if (!storageReady) return;
    let imported;

    try {
      imported = settingsTools.parseImportedSettings(
        elements.importExportText.value,
      );
    } catch (error) {
      elements.importExportText.setAttribute("aria-invalid", "true");
      reportError("validation_failed");
      showBackupStatus(
        error && error.message ? error.message : "Import failed.",
        true,
      );
      return;
    }

    disarmResetDefaults();
    elements.importExportText.setAttribute("aria-invalid", "false");
    settings = imported;
    settingsRevision += 1;
    renderSettings();
    pendingStoredSettings = null;
    writeSettingsToStorage(settings, () =>
      showBackupStatus("Preferences saved.", false),
    );
    sendSettingsToActiveTab();
  }

  function handleResetDefaults() {
    if (!storageReady) return;
    if (resetArmed) {
      performResetDefaults();
      return;
    }
    resetArmed = true;
    elements.resetDefaultsButton.textContent = resetArmedLabel;
    elements.resetDefaultsButton.classList.add("danger");
    elements.cancelReset.hidden = false;
    showBackupStatus(
      "Reset replaces all preferences with defaults. Confirm reset or cancel when ready.",
      false,
    );
  }

  function disarmResetDefaults() {
    resetArmed = false;
    elements.resetDefaultsButton.textContent = resetDefaultLabel;
    elements.resetDefaultsButton.classList.remove("danger");
    elements.cancelReset.hidden = true;
  }

  function performResetDefaults() {
    disarmResetDefaults();
    settings = settingsTools.normalize({});
    settingsRevision += 1;
    renderSettings();
    pendingStoredSettings = null;
    writeSettingsToStorage(settings, () =>
      showBackupStatus("Preferences saved.", false),
    );
    sendSettingsToActiveTab();
  }

  function copyTextToClipboard(text, callback) {
    const clipboard = root.navigator && root.navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      clipboard.writeText(text).then(
        () => callback(true),
        () => callback(false),
      );
      return;
    }

    callback(legacyCopySelection());
  }

  function legacyCopySelection() {
    try {
      return document.execCommand("copy");
    } catch (error) {
      return false;
    }
  }

  function showBackupStatus(message, isError) {
    elements.backupStatus.textContent = message;
    elements.backupStatus.classList.toggle("error", Boolean(isError));
  }

  function showSettingsStatus(message, isError) {
    elements.settingsStatus.textContent = message;
    elements.settingsStatus.classList.toggle("error", Boolean(isError));
    if (!isError && document.activeElement === elements.retrySettings)
      elements.settingsStatus.focus();
    elements.retrySettings.hidden = !isError;
  }

  function setStorageReady(ready) {
    storageReady = ready;
    for (const input of document.querySelectorAll(
      "input:not(#telemetryEnabled), [data-speed], #importButton, #resetDefaultsButton, #exportButton, #decrease, #increase, #reset",
    ))
      input.disabled = !ready;
  }

  function validNumber(input) {
    if (input.value.trim() && Number.isFinite(Number(input.value))) return true;
    showSettingsStatus("Enter a number within the displayed limits.", false);
    renderSettings();
    return false;
  }

  function reportError(category) {
    if (root.WatchDashTelemetry)
      root.WatchDashTelemetry.error(category, "popup");
  }

  function setHidden(element, hidden) {
    if (
      hidden &&
      typeof element.contains === "function" &&
      element.contains(document.activeElement)
    )
      elements.openSettings.focus();
    element.hidden = hidden;
  }

  function siteFailure() {
    elements.siteStatus.textContent =
      "Site activation failed. Try again or reload the tab.";
    reportError("permission_failed");
    renderSiteAccessButton();
  }

  function extensionApis() {
    const api = root.chrome;
    if (
      !api ||
      !api.tabs ||
      !api.storage ||
      !api.storage.sync ||
      !api.runtime
    ) {
      return null;
    }

    return api;
  }

  // Optional-site registration must run the same ordered bundle as the static
  // manifest entry: the content modules communicate through shared globals.
  function contentScriptFiles(api) {
    const manifest =
      typeof api.runtime.getManifest === "function"
        ? api.runtime.getManifest()
        : null;
    const contentScript =
      manifest && Array.isArray(manifest.content_scripts)
        ? manifest.content_scripts[0]
        : null;
    return contentScript && Array.isArray(contentScript.js)
      ? contentScript.js.slice()
      : [];
  }
})(globalThis);
