(function registerWatchDashSettings(root) {
  const defaults = root.WatchDashDefaults;

  if (!defaults) {
    return;
  }

  const qualityTargets = Object.freeze([480, 720, 1080, 1440, 2160]);
  const minSpeedLimit = 0.25;
  const maxSpeedLimit = 16;
  // strings people write by hand or paste from other tools
  const booleanFalseTexts = new Set(["", "false", "0", "off", "no"]);

  function normalize(value) {
    const rawSettings = unwrapStorageValue(value);
    const input =
      rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const next = {};

    for (const [key, defaultValue] of Object.entries(
      defaults.defaultSettings,
    )) {
      const value = Object.prototype.hasOwnProperty.call(input, key)
        ? input[key]
        : defaultValue;
      next[key] =
        typeof defaultValue === "boolean" ? coerceBoolean(value) : value;
    }
    next.minSpeed = clampNumber(
      next.minSpeed,
      minSpeedLimit,
      maxSpeedLimit,
      defaults.defaultSettings.minSpeed,
    );
    next.maxSpeed = clampNumber(
      next.maxSpeed,
      minSpeedLimit,
      maxSpeedLimit,
      defaults.defaultSettings.maxSpeed,
    );

    if (next.minSpeed > next.maxSpeed) {
      next.minSpeed = defaults.defaultSettings.minSpeed;
      next.maxSpeed = defaults.defaultSettings.maxSpeed;
    }

    next.targetSpeed = clampNumber(
      next.targetSpeed,
      next.minSpeed,
      next.maxSpeed,
      1,
    );
    next.speedStep = clampNumber(
      next.speedStep,
      0.01,
      1,
      defaults.defaultSettings.speedStep,
    );
    next.qualityTargetHeight = clampQualityTarget(next.qualityTargetHeight);
    next.youtubeAdSpeed = clampNumber(
      next.youtubeAdSpeed,
      1,
      next.maxSpeed,
      defaults.defaultSettings.youtubeAdSpeed,
    );
    next.clickCooldownMs = clampNumber(
      next.clickCooldownMs,
      500,
      10000,
      defaults.defaultSettings.clickCooldownMs,
    );
    return next;
  }

  function coerceBoolean(value) {
    if (typeof value === "string") {
      return !booleanFalseTexts.has(value.trim().toLowerCase());
    }

    return Boolean(value);
  }

  function hasKnownSettingKey(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    return Object.keys(defaults.defaultSettings).some((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    );
  }

  function isSettingsPayload(value) {
    return hasKnownSettingKey(value);
  }

  function parseImportedSettings(text) {
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("Paste exported WatchDash settings as JSON text first.");
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error("That text is not valid JSON.");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected a JSON object of WatchDash settings.");
    }

    const source = resolveImportSource(parsed);

    if (!hasKnownSettingKey(source)) {
      throw new Error("No WatchDash settings were found in that JSON.");
    }

    return normalize(source);
  }

  function resolveImportSource(parsed) {
    let source = parsed;

    if (
      source.watchDashSettings &&
      typeof source.watchDashSettings === "object"
    ) {
      source = source.watchDashSettings;
    }

    if (
      source.settings &&
      typeof source.settings === "object" &&
      !Array.isArray(source.settings)
    ) {
      source = source.settings;
    }

    return source;
  }

  function toExportText(value) {
    return JSON.stringify(toStorageValue(value), null, 2);
  }

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(numeric * 100) / 100));
  }

  function clampQualityTarget(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return defaults.defaultSettings.qualityTargetHeight;
    }

    return qualityTargets.reduce((best, target) => {
      return Math.abs(target - numeric) < Math.abs(best - numeric)
        ? target
        : best;
    }, qualityTargets[0]);
  }

  function qualityTargetIndex(height) {
    return Math.max(0, qualityTargets.indexOf(clampQualityTarget(height)));
  }

  function qualityTargetText(height) {
    const target = clampQualityTarget(height);
    return target >= 2160 ? "4K" : `${target}p`;
  }

  function unwrapStorageValue(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (value.settings && typeof value.settings === "object") {
      return value.settings;
    }

    return value;
  }

  function toStorageValue(value) {
    return {
      version: defaults.version,
      settings: normalize(value),
    };
  }

  function needsStorageMigration(value) {
    if (!value || typeof value !== "object") {
      return true;
    }

    return (
      value.version !== defaults.version ||
      !value.settings ||
      typeof value.settings !== "object"
    );
  }

  root.WatchDashSettings = Object.freeze({
    qualityTargets,
    normalize,
    coerceBoolean,
    clampNumber,
    clampQualityTarget,
    qualityTargetIndex,
    qualityTargetText,
    toExportText,
    parseImportedSettings,
    isSettingsPayload,
    toStorageValue,
    needsStorageMigration,
  });
})(globalThis);
