(function registerWatchDashSettings(root) {
  const defaults = root.WatchDashDefaults;

  if (!defaults) {
    return;
  }

  const qualityTargets = Object.freeze([480, 720, 1080, 1440, 2160]);
  const minSpeedLimit = 0.25;
  const maxSpeedLimit = 16;

  function normalize(value) {
    const rawSettings = unwrapStorageValue(value);
    const input = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const next = {};

    for (const key of Object.keys(defaults.defaultSettings)) {
      next[key] = Object.prototype.hasOwnProperty.call(input, key) ?
        input[key] :
        defaults.defaultSettings[key];
    }

    next.enabled = Boolean(next.enabled);
    next.speedControls = Boolean(next.speedControls);
    next.skipIntros = Boolean(next.skipIntros);
    next.skipRecaps = Boolean(next.skipRecaps);
    next.skipCredits = Boolean(next.skipCredits);
    next.autoNextEpisode = Boolean(next.autoNextEpisode);
    next.continuePlaying = Boolean(next.continuePlaying);
    next.qualityDiagnostics = Boolean(next.qualityDiagnostics);
    next.youtubeQualityControls = Boolean(next.youtubeQualityControls);
    next.youtubeAdSpeedup = Boolean(next.youtubeAdSpeedup);
    next.youtubeAutoSkipAds = Boolean(next.youtubeAutoSkipAds);
    next.hotkeys = Boolean(next.hotkeys);
    next.minSpeed = clampNumber(next.minSpeed, minSpeedLimit, maxSpeedLimit, defaults.defaultSettings.minSpeed);
    next.maxSpeed = clampNumber(next.maxSpeed, minSpeedLimit, maxSpeedLimit, defaults.defaultSettings.maxSpeed);

    if (next.minSpeed > next.maxSpeed) {
      next.minSpeed = defaults.defaultSettings.minSpeed;
      next.maxSpeed = defaults.defaultSettings.maxSpeed;
    }

    next.targetSpeed = clampNumber(next.targetSpeed, next.minSpeed, next.maxSpeed, 1);
    next.speedStep = clampNumber(next.speedStep, 0.01, 1, defaults.defaultSettings.speedStep);
    next.qualityTargetHeight = clampQualityTarget(next.qualityTargetHeight);
    next.youtubeAdSpeed = clampNumber(next.youtubeAdSpeed, 1, next.maxSpeed, defaults.defaultSettings.youtubeAdSpeed);
    next.clickCooldownMs = clampNumber(next.clickCooldownMs, 500, 10000, defaults.defaultSettings.clickCooldownMs);
    return next;
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
      return Math.abs(target - numeric) < Math.abs(best - numeric) ? target : best;
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
      settings: normalize(value)
    };
  }

  function needsStorageMigration(value) {
    if (!value || typeof value !== "object") {
      return true;
    }

    return value.version !== defaults.version ||
      !value.settings ||
      typeof value.settings !== "object";
  }

  root.WatchDashSettings = Object.freeze({
    qualityTargets,
    normalize,
    clampNumber,
    clampQualityTarget,
    qualityTargetIndex,
    qualityTargetText,
    toStorageValue,
    needsStorageMigration
  });
})(globalThis);
