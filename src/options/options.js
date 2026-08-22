(function watchDashOptions(root) {
  const defaults = root.WatchDashDefaults;
  const settingsTools = root.WatchDashSettings;
  const platforms = Array.isArray(root.WatchDashPlatforms)
    ? root.WatchDashPlatforms
    : [];
  const storageKey = defaults.storageKey;
  const qualityTargets = settingsTools.qualityTargets;
  const storageWriteDelayMs = 500;
  const resetConfirmDelayMs = 3000;
  const resetDefaultLabel = "Reset Defaults";
  const resetArmedLabel = "Confirm Reset";
  const featureLabels = {
    youtubeQualityControls: "Quality target",
    youtubeAdControls: "Ad tools",
  };
  const hostlessNotes = { jellyfin: "detected via app signals" };

  let settings = settingsTools.normalize();
  let pendingStoredSettings = null;
  let settingsPersistTimer = null;
  let settingInputs = [];
  let capabilityChips = [];
  let resetArmTimer = null;

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    collectElements();
    buildPlatformCards();
    wireEvents();
    loadSettings();
  }

  function collectElements() {
    settingInputs = Array.from(
      document.querySelectorAll("input[data-setting]"),
    );

    for (const input of settingInputs) {
      elements[input.dataset.setting] = input;
    }

    for (const id of [
      "targetSpeed",
      "targetSpeedRange",
      "speedChip",
      "speedStep",
      "maxSpeed",
      "qualityTarget",
      "qualityTargetLabel",
      "clickCooldownMs",
      "youtubeAdSpeed",
      "platformList",
      "exportButton",
      "importButton",
      "resetDefaultsButton",
      "importExportText",
      "backupStatus",
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

    elements.targetSpeed.addEventListener("change", () => {
      updateSettings({ targetSpeed: Number(elements.targetSpeed.value) });
      flushSettingsPersist();
    });

    elements.targetSpeedRange.addEventListener("input", () => {
      updateSettings({ targetSpeed: Number(elements.targetSpeedRange.value) });
    });
    elements.targetSpeedRange.addEventListener("change", flushSettingsPersist);

    for (const id of ["speedStep", "maxSpeed", "clickCooldownMs"]) {
      elements[id].addEventListener("change", () => {
        updateSettings({ [id]: Number(elements[id].value) });
        flushSettingsPersist();
      });
    }

    elements.qualityTarget.addEventListener("input", () => {
      const index = Number(elements.qualityTarget.value);
      updateSettings({ qualityTargetHeight: qualityTargets[index] || 1080 });
    });
    elements.qualityTarget.addEventListener("change", flushSettingsPersist);

    elements.youtubeAdSpeed.addEventListener("change", () => {
      updateSettings({
        youtubeAdSpeed: Number(elements.youtubeAdSpeed.value),
      });
      flushSettingsPersist();
    });

    elements.exportButton.addEventListener("click", runExport);
    elements.importButton.addEventListener("click", runImport);
    elements.resetDefaultsButton.addEventListener("click", handleResetDefaults);
    root.addEventListener("pagehide", flushSettingsPersist);
  }

  function loadSettings() {
    const api = extensionApis();
    if (!api) {
      renderSettings();
      return;
    }

    api.storage.sync.get([storageKey], (result) => {
      if (api.runtime.lastError) {
        console.warn(
          "WatchDash could not load settings:",
          api.runtime.lastError.message,
        );
        renderSettings();
        return;
      }

      const storedSettings = result[storageKey];
      settings = settingsTools.normalize(storedSettings);

      if (settingsTools.needsStorageMigration(storedSettings)) {
        writeSettingsToStorage(settings);
      }

      renderSettings();
    });
  }

  function updateSettings(partial) {
    const api = extensionApis();
    settings = settingsTools.normalize(Object.assign({}, settings, partial));
    renderSettings();

    if (api) {
      scheduleSettingsPersist();
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

    api.storage.sync.set(
      {
        [storageKey]: settingsTools.toStorageValue(nextSettings),
      },
      () => {
        if (api.runtime.lastError) {
          console.warn(
            "WatchDash could not save settings:",
            api.runtime.lastError.message,
          );
        }
      },
    );
  }

  function renderSettings() {
    for (const input of settingInputs) {
      input.checked = Boolean(settings[input.dataset.setting]);
    }

    elements.targetSpeed.min = settings.minSpeed;
    elements.targetSpeed.max = settings.maxSpeed;
    elements.targetSpeed.step = settings.speedStep;
    elements.targetSpeed.value = settings.targetSpeed.toFixed(2);
    elements.targetSpeedRange.min = settings.minSpeed;
    elements.targetSpeedRange.max = settings.maxSpeed;
    elements.targetSpeedRange.step = settings.speedStep;
    elements.targetSpeedRange.value = settings.targetSpeed;
    elements.speedChip.textContent = `${settings.targetSpeed.toFixed(2)}x`;
    elements.speedStep.value = settings.speedStep.toFixed(2);
    elements.maxSpeed.value = settings.maxSpeed.toFixed(2);
    elements.qualityTarget.value = settingsTools.qualityTargetIndex(
      settings.qualityTargetHeight,
    );
    elements.qualityTargetLabel.textContent = settingsTools.qualityTargetText(
      settings.qualityTargetHeight,
    );
    elements.clickCooldownMs.value = String(
      Math.round(settings.clickCooldownMs),
    );
    elements.youtubeAdSpeed.max = settings.maxSpeed;
    elements.youtubeAdSpeed.value = settings.youtubeAdSpeed.toFixed(2);
    renderRangeFill(elements.targetSpeedRange);
    renderRangeFill(elements.qualityTarget);
    renderCapabilityStates();
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

  function buildPlatformCards() {
    const fragment = document.createDocumentFragment();
    capabilityChips = [];

    for (const platform of platforms) {
      fragment.appendChild(buildPlatformCard(platform));
    }

    elements.platformList.appendChild(fragment);
  }

  function buildPlatformCard(platform) {
    const card = document.createElement("article");
    card.className = "platform-card";

    const head = document.createElement("header");
    const heading = document.createElement("h3");
    heading.textContent = platform.label;
    const hostLine = document.createElement("span");
    hostLine.className = "host-line";
    hostLine.textContent = hostText(platform);
    head.appendChild(heading);
    head.appendChild(hostLine);

    const list = document.createElement("ul");
    list.className = "capability-list";

    for (const action of platform.actions) {
      list.appendChild(
        capabilityItem(
          action.controlLabel || action.label,
          action.setting,
          cooldownText(action.cooldownMs),
        ),
      );
    }

    for (const key of Object.keys(platform.features || {})) {
      const dynamic =
        typeof defaults.defaultSettings[key] === "boolean" &&
        Object.prototype.hasOwnProperty.call(defaults.defaultSettings, key);
      list.appendChild(
        capabilityItem(featureLabels[key] || key, dynamic ? key : null, ""),
      );
    }

    card.appendChild(head);
    card.appendChild(list);
    return card;
  }

  function capabilityItem(labelText, settingKey, title) {
    const item = document.createElement("li");
    item.className = "cap";

    if (title) {
      item.title = title;
    }

    const name = document.createElement("span");
    name.textContent = labelText;
    item.appendChild(name);

    const state = document.createElement("span");
    state.className = "sr-only";
    item.appendChild(state);

    capabilityChips.push({
      element: item,
      stateElement: state,
      setting: settingKey,
    });
    return item;
  }

  function renderCapabilityStates() {
    for (const chip of capabilityChips) {
      if (!chip.setting) {
        chip.element.dataset.state = "info";
        chip.stateElement.textContent = "built in";
        continue;
      }

      const on = Boolean(settings[chip.setting]);
      chip.element.dataset.state = on ? "on" : "off";
      chip.stateElement.textContent = on ? "on" : "off";
    }
  }

  function hostText(platform) {
    const hosts = platform.hostPatterns || [];

    if (hosts.length === 0) {
      return hostlessNotes[platform.id] || "detector-based";
    }

    const rest = hosts.length - 1;
    return rest > 0 ? `${hosts[0]} +${rest} more` : hosts[0];
  }

  function cooldownText(cooldownMs) {
    if (!cooldownMs || cooldownMs <= 0) {
      return "";
    }

    return cooldownMs >= 1000
      ? `cooldown ${Math.round(cooldownMs / 1000)}s`
      : `cooldown ${cooldownMs}ms`;
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
    let imported;

    try {
      imported = settingsTools.parseImportedSettings(
        elements.importExportText.value,
      );
    } catch (error) {
      showBackupStatus(
        error && error.message ? error.message : "Import failed.",
        true,
      );
      return;
    }

    settings = imported;
    renderSettings();
    pendingStoredSettings = null;
    writeSettingsToStorage(settings);
    showBackupStatus("Settings imported and applied.", false);
  }

  function handleResetDefaults() {
    if (resetArmTimer) {
      root.clearTimeout(resetArmTimer);
      resetArmTimer = null;
      performResetDefaults();
      return;
    }

    elements.resetDefaultsButton.textContent = resetArmedLabel;
    elements.resetDefaultsButton.classList.add("danger");

    resetArmTimer = root.setTimeout(disarmResetDefaults, resetConfirmDelayMs);
  }

  function disarmResetDefaults() {
    resetArmTimer = null;
    elements.resetDefaultsButton.textContent = resetDefaultLabel;
    elements.resetDefaultsButton.classList.remove("danger");
  }

  function performResetDefaults() {
    disarmResetDefaults();
    settings = settingsTools.normalize({});
    renderSettings();
    pendingStoredSettings = null;
    writeSettingsToStorage(settings);
    showBackupStatus("All settings restored to defaults.", false);
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

  function extensionApis() {
    const api = root.chrome;
    if (!api || !api.storage || !api.storage.sync || !api.runtime) {
      return null;
    }

    return api;
  }
})(globalThis);
