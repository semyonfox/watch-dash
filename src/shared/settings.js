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
    for (const key of ["increaseHotkey", "decreaseHotkey", "resetHotkey"]) {
      next[key] = typeof input[key] === "string" && (input[key] === "" || parseHotkey(input[key]))
        ? input[key] : defaults.defaultSettings[key];
    }
    next.speedMemory = ["global", "platform", "site"].includes(input.speedMemory) ? input.speedMemory : "global";
    next.platformSpeeds = cleanSpeeds(input.platformSpeeds, false, next);
    next.originSpeeds = cleanSpeeds(input.originSpeeds, true, next);
    next.disabledOrigins = Array.isArray(input.disabledOrigins)
      ? [...new Set(input.disabledOrigins.filter(validOrigin))].slice(0, 20) : [];
    return next;
  }

  function parseHotkey(binding) {
    if (typeof binding !== "string" || binding.length > 60) return null;
    const match = /^(Alt\+)?(Shift\+)?(key|code):(.+)$/.exec(binding);
    if (!match) return null;
    return { alt: Boolean(match[1]), shift: Boolean(match[2]), kind: match[3], value: match[4] };
  }

  function matchesHotkey(event, binding) {
    const parsed = parseHotkey(binding);
    return Boolean(parsed && !event.defaultPrevented && !event.repeat && !event.isComposing &&
      !event.ctrlKey && !event.metaKey && !event.getModifierState?.("AltGraph") &&
      Boolean(event.altKey) === parsed.alt && Boolean(event.shiftKey) === parsed.shift &&
      event[parsed.kind] === parsed.value);
  }

  function validOrigin(value) {
    if (typeof value !== "string" || value.length > 100) return false;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && url.origin === value;
    } catch { return false; }
  }

  function cleanSpeeds(value, origins, settings) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value).filter(([key, speed]) =>
      (origins ? validOrigin(key) : /^[a-z][a-z0-9-]{0,30}$/.test(key)) &&
      typeof speed === "number" && Number.isFinite(speed));
    return Object.fromEntries(entries.slice(-20).map(([key, speed]) =>
      [key, clampNumber(speed, settings.minSpeed, settings.maxSpeed, 1)]));
  }

  function speedFor(settings, origin, platform) {
    const speed = settings.speedMemory === "site" ? settings.originSpeeds[origin]
      : settings.speedMemory === "platform" ? settings.platformSpeeds[platform] : undefined;
    return speed ?? settings.targetSpeed;
  }

  function rememberSpeed(settings, speed, origin, platform) {
    const field = settings.speedMemory === "site" && validOrigin(origin) ? "originSpeeds"
      : settings.speedMemory === "platform" && platform ? "platformSpeeds" : null;
    if (!field) return normalize({ ...settings, targetSpeed: speed });
    const key = field === "originSpeeds" ? origin : platform;
    const entries = Object.entries(settings[field]).filter(([entry]) => entry !== key);
    return normalize({ ...settings, [field]: Object.fromEntries([...entries, [key, speed]]) });
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
    parseHotkey,
    matchesHotkey,
    validOrigin,
    speedFor,
    rememberSpeed,
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
