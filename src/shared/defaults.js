(function registerWatchDashDefaults(root) {
  const defaultSettings = {
    enabled: true,
    speedControls: true,
    targetSpeed: 1,
    speedStep: 0.05,
    minSpeed: 0.25,
    maxSpeed: 16,
    skipIntros: true,
    skipRecaps: true,
    skipCredits: true,
    autoNextEpisode: true,
    continuePlaying: true,
    qualityDiagnostics: true,
    qualityTargetHeight: 1080,
    youtubeQualityControls: true,
    youtubeAdSpeedup: true,
    youtubeAdSpeed: 16,
    youtubeAutoSkipAds: true,
    clickCooldownMs: 1600,
    hotkeys: true
  };

  root.WatchDashDefaults = Object.freeze({
    storageKey: "watchDashSettings",
    defaultSettings,
    version: 1
  });
})(globalThis);
