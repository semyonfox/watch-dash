(function watchDashContent(root) {
  const defaults = root.WatchDashDefaults;
  const settingsTools = root.WatchDashSettings;
  const media = root.WatchDashMedia;
  const automation = root.WatchDashAutomation;
  const platforms = root.WatchDashPlatforms || [];
  const youtubeController = root.WatchDashYouTubeController || null;

  if (!defaults || !settingsTools || !media || !automation) {
    return;
  }

  if (root.WatchDashContentLoaded) {
    return;
  }

  root.WatchDashContentLoaded = true;

  const storageKey = defaults.storageKey;
  const storageWriteDelayMs = 500;
  const textFallbackCooldownMs = 2500;
  const minimumAutomationVideoWidth = 240;
  const minimumAutomationVideoHeight = 135;
  const minimumAutomationDurationSeconds = 120;
  let settings = settingsTools.normalize();
  let currentPlatform = detectPlatform();
  let lastAction = null;
  let lastActionAt = 0;
  let scheduled = false;
  let lastDisplayedSpeed = null;
  let speedToastTimer = null;
  let adSpeedWasActive = false;
  let pendingStoredSettings = null;
  let settingsPersistTimer = null;
  let activeVideo = null;
  let lastTextFallbackScanAt = 0;

  const actionCooldowns = new Map();
  let adSpeedRestoreRates = new WeakMap();

  function detectPlatform() {
    const host = location.hostname.replace(/^www\./, "").toLowerCase();

    return platforms.find((platform) => {
      const hostPatterns = platform.hostPatterns || [];
      const hostMatches = hostPatterns.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));
      const detectorMatches = typeof platform.detect === "function" && runPlatformDetector(platform);

      return hostMatches || detectorMatches;
    }) || null;
  }

  function runPlatformDetector(platform) {
    try {
      return Boolean(platform.detect({
        document,
        host: location.hostname,
        path: location.pathname,
        url: location.href
      }));
    } catch (error) {
      return false;
    }
  }

  function loadSettings() {
    chrome.storage.sync.get([storageKey], (result) => {
      if (chrome.runtime.lastError) {
        console.warn("WatchDash could not load settings:", chrome.runtime.lastError.message);
        tick();
        return;
      }

      const storedSettings = result[storageKey];
      settings = settingsTools.normalize(storedSettings);

      if (settingsTools.needsStorageMigration(storedSettings)) {
        writeSettingsToStorage(settings);
      }

      tick();
    });
  }

  function persistSettings(nextSettings) {
    applySettings(nextSettings);
    scheduleSettingsPersist();
  }

  function applySettings(nextSettings) {
    settings = settingsTools.normalize(nextSettings);
    tick();
  }

  function scheduleSettingsPersist() {
    pendingStoredSettings = settings;

    if (settingsPersistTimer) {
      window.clearTimeout(settingsPersistTimer);
    }

    settingsPersistTimer = window.setTimeout(() => {
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
    chrome.storage.sync.set({
      [storageKey]: settingsTools.toStorageValue(nextSettings)
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn("WatchDash could not save settings:", chrome.runtime.lastError.message);
      }
    });
  }

  function applySpeed() {
    if (!settings.enabled || !currentPlatform) {
      return;
    }

    const videos = media.listVideos();
    const adSpeedActive = shouldUseYouTubeAdSpeed();

    if (adSpeedActive) {
      captureAdSpeedRestoreRates(videos);
      adSpeedWasActive = true;
      applyPlaybackRate(videos, settings.youtubeAdSpeed);
      return;
    }

    if (adSpeedWasActive) {
      restoreAdPlaybackRates(videos);
      adSpeedWasActive = false;
      adSpeedRestoreRates = new WeakMap();
    }

    if (!settings.speedControls) {
      return;
    }

    applyPlaybackRate(videos, settingsTools.clampNumber(settings.targetSpeed, settings.minSpeed, settings.maxSpeed, 1));
  }

  function shouldUseYouTubeAdSpeed() {
    return Boolean(settings.youtubeAdSpeedup &&
      youtubeController &&
      currentPlatform &&
      currentPlatform.id === "youtube" &&
      youtubeController.isAdShowing(currentPlatform));
  }

  function captureAdSpeedRestoreRates(videos) {
    for (const video of videos) {
      if (!adSpeedRestoreRates.has(video)) {
        adSpeedRestoreRates.set(video, {
          playbackRate: video.playbackRate,
          defaultPlaybackRate: video.defaultPlaybackRate
        });
      }
    }
  }

  function restoreAdPlaybackRates(videos) {
    const targetSpeed = settings.speedControls ?
      settingsTools.clampNumber(settings.targetSpeed, settings.minSpeed, settings.maxSpeed, 1) :
      null;
    let changed = false;
    let displayedSpeed = targetSpeed;

    for (const video of videos) {
      const savedRates = adSpeedRestoreRates.get(video);
      const playbackRate = targetSpeed || savedRates && savedRates.playbackRate;
      const defaultPlaybackRate = targetSpeed || savedRates && savedRates.defaultPlaybackRate;

      if (Number.isFinite(playbackRate) && Math.abs(video.playbackRate - playbackRate) > 0.001) {
        video.playbackRate = playbackRate;
        changed = true;
        displayedSpeed = playbackRate;
      }

      if (Number.isFinite(defaultPlaybackRate) && Math.abs(video.defaultPlaybackRate - defaultPlaybackRate) > 0.001) {
        video.defaultPlaybackRate = defaultPlaybackRate;
      }
    }

    if (changed && videos.length > 0 && Number.isFinite(displayedSpeed) && lastDisplayedSpeed !== displayedSpeed) {
      showSpeedToast(displayedSpeed);
      lastDisplayedSpeed = displayedSpeed;
    }
  }

  function applyPlaybackRate(videos, speed) {
    let changed = false;

    for (const video of videos) {
      if (Math.abs(video.playbackRate - speed) > 0.001) {
        video.playbackRate = speed;
        changed = true;
      }

      if (Math.abs(video.defaultPlaybackRate - speed) > 0.001) {
        video.defaultPlaybackRate = speed;
      }
    }

    if (changed && videos.length > 0 && lastDisplayedSpeed !== speed) {
      showSpeedToast(speed);
      lastDisplayedSpeed = speed;
    }
  }

  function applyQualityHints(video) {
    if (!settings.enabled || !currentPlatform) {
      return;
    }

    if (!video) {
      return;
    }

    if (currentPlatform.id === "youtube" && youtubeController) {
      youtubeController.applyQualityTarget(currentPlatform, settings);
    }

    if (!settings.qualityDiagnostics) {
      return;
    }

    if (video.preload !== "auto") {
      video.preload = "auto";
    }
  }

  function runAutomation(video) {
    if (!settings.enabled || !currentPlatform || !currentPlatform.actions) {
      return;
    }

    if (!currentPlatform.actions.some((action) => settings[action.setting])) {
      return;
    }

    const now = Date.now();
    const allowTextFallback = now - lastTextFallbackScanAt >= textFallbackCooldownMs;

    if (allowTextFallback) {
      lastTextFallbackScanAt = now;
    }

    for (const action of currentPlatform.actions) {
      if (!settings[action.setting]) {
        continue;
      }

      const cooldownMs = action.cooldownMs || settings.clickCooldownMs;
      const previousClickAt = actionCooldowns.get(action.id) || 0;

      if (now - previousClickAt < cooldownMs) {
        continue;
      }

      const target = automation.findActionTarget(action, { allowTextFallback });
      if (!target) {
        continue;
      }

      if (!shouldRunAction(action, target, video)) {
        continue;
      }

      actionCooldowns.set(action.id, now);
      automation.clickElement(target);
      lastAction = action.label;
      lastActionAt = now;
      break;
    }
  }

  function shouldRunAction(action, target, video) {
    if (action.type === "adSkip") {
      return currentPlatform && currentPlatform.id === "youtube" &&
        isPlaybackSurface(video) &&
        Boolean(video) &&
        youtubeController &&
        youtubeController.isAdShowing(currentPlatform);
    }

    if (action.type !== "nextEpisode") {
      return isPlaybackSurface(video) && isMeaningfulAutomationVideo(video);
    }

    if (!isPlaybackSurface(video)) {
      return false;
    }

    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return false;
    }

    if (video.ended) {
      return true;
    }

    const progress = video.currentTime / video.duration;
    const remainingSeconds = video.duration - video.currentTime;
    const minProgressBeforeEnded = Number.isFinite(action.minProgressBeforeEnded) ?
      action.minProgressBeforeEnded :
      0.999;
    const maxRemainingSecondsBeforeEnded = Number.isFinite(action.maxRemainingSecondsBeforeEnded) ?
      action.maxRemainingSecondsBeforeEnded :
      1;

    return Boolean(target) &&
      progress >= minProgressBeforeEnded &&
      remainingSeconds <= maxRemainingSecondsBeforeEnded;
  }

  function isPlaybackSurface(video) {
    if (!currentPlatform) {
      return false;
    }

    const patterns = currentPlatform.watchUrlPatterns ||
      (currentPlatform.watchUrlPattern ? [currentPlatform.watchUrlPattern] : []);

    if (patterns.some((pattern) => pathMatchesPattern(location.pathname, pattern))) {
      return true;
    }

    return Boolean(currentPlatform.allowVideoSurfaceFallback && isMeaningfulAutomationVideo(video));
  }

  function pathMatchesPattern(pathname, pattern) {
    const path = String(pathname || "/");
    const value = String(pattern || "").trim();

    if (!value) {
      return false;
    }

    if (value.endsWith("-")) {
      return path.startsWith(value);
    }

    if (value.endsWith("/")) {
      return path === value.slice(0, -1) || path.startsWith(value);
    }

    return path === value || path.startsWith(`${value}/`);
  }

  function isMeaningfulAutomationVideo(video) {
    if (!video) {
      return false;
    }

    let rect;
    try {
      rect = video.getBoundingClientRect();
    } catch (error) {
      return false;
    }

    if (rect.width < minimumAutomationVideoWidth || rect.height < minimumAutomationVideoHeight) {
      return false;
    }

    const duration = Number(video.duration);
    return !Number.isFinite(duration) ||
      duration >= minimumAutomationDurationSeconds ||
      Number(video.currentTime) >= 30;
  }

  function changeSpeed(delta) {
    const targetSpeed = settingsTools.clampNumber(settings.targetSpeed + delta, settings.minSpeed, settings.maxSpeed, 1);
    showSpeedToast(targetSpeed);
    persistSettings(Object.assign({}, settings, { targetSpeed }));
  }

  function handleCommand(command) {
    if (!currentPlatform) {
      return;
    }

    if (command === "increase-speed") {
      changeSpeed(settings.speedStep);
      return;
    }

    if (command === "decrease-speed") {
      changeSpeed(-settings.speedStep);
      return;
    }

    if (command === "reset-speed") {
      persistSettings(Object.assign({}, settings, { targetSpeed: 1 }));
      return;
    }

    if (command === "toggle-autopilot") {
      persistSettings(Object.assign({}, settings, { enabled: !settings.enabled }));
    }
  }

  function handleHotkey(event) {
    if (!settings.enabled || !settings.hotkeys || !currentPlatform || event.defaultPrevented || event.ctrlKey || event.metaKey) {
      return;
    }

    if (isEditableTarget(event)) {
      return;
    }

    const increaseRequested = (!event.altKey && (event.key === "+" || event.key === "=" || event.code === "Equal")) ||
      (event.altKey && event.key === "]");
    const decreaseRequested = (!event.altKey && (event.key === "-" || event.code === "Minus")) ||
      (event.altKey && event.key === "[");

    if (increaseRequested) {
      event.preventDefault();
      changeSpeed(settings.speedStep);
      return;
    }

    if (decreaseRequested) {
      event.preventDefault();
      changeSpeed(-settings.speedStep);
      return;
    }

    if (event.key === "\\") {
      event.preventDefault();
      persistSettings(Object.assign({}, settings, { targetSpeed: 1 }));
    }
  }

  function getStatus() {
    const video = activeVideo || media.findActiveVideo();
    const quality = media.getPlaybackQuality(video);

    return {
      platform: currentPlatform ? currentPlatform.id : "unknown",
      platformLabel: currentPlatform ? currentPlatform.label : "Unknown",
      playbackSettingsUrl: currentPlatform ? currentPlatform.playbackSettingsUrl || null : null,
      platformFeatures: currentPlatform ? currentPlatform.features || {} : {},
      actionSettings: currentPlatform ? (currentPlatform.actions || []).map((action) => action.setting) : [],
      actionControls: currentPlatform ? actionControls(currentPlatform.actions || []) : [],
      enabled: settings.enabled,
      targetSpeed: settings.targetSpeed,
      activeSpeed: video ? Math.round(video.playbackRate * 100) / 100 : null,
      youtubeAdShowing: currentPlatform && currentPlatform.id === "youtube" && youtubeController ?
        youtubeController.isAdShowing(currentPlatform) :
        false,
      youtubeQuality: currentPlatform && currentPlatform.id === "youtube" && youtubeController ?
        youtubeController.getQualityStatus(currentPlatform) :
        null,
      videoWidth: video && video.videoWidth ? video.videoWidth : null,
      videoHeight: video && video.videoHeight ? video.videoHeight : null,
      qualityTargetHeight: settings.qualityTargetHeight,
      qualityTargetMet: video && video.videoHeight ? video.videoHeight >= settings.qualityTargetHeight : null,
      droppedVideoFrames: quality ? quality.droppedVideoFrames : null,
      totalVideoFrames: quality ? quality.totalVideoFrames : null,
      lastAction,
      lastActionAt,
      url: location.href
    };
  }

  function actionControls(actions) {
    const controls = [];
    const seen = new Set();

    for (const action of actions) {
      if (!action.setting || seen.has(action.setting)) {
        continue;
      }

      seen.add(action.setting);
      controls.push({
        setting: action.setting,
        label: action.label || action.setting
      });
    }

    return controls;
  }

  function tick() {
    currentPlatform = detectPlatform();
    activeVideo = media.findActiveVideo();
    applySpeed();
    applyQualityHints(activeVideo);
    runAutomation(activeVideo);
  }

  function scheduleTick() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      tick();
    }, 250);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (!isTrustedSender(sender)) {
      return false;
    }

    if (message.type === "watch-dash:get-status") {
      tick();
      sendResponse({ ok: true, settings, status: getStatus() });
      return true;
    }

    if (message.type === "watch-dash:set-settings") {
      if (message.settings && Number(message.settings.targetSpeed) !== Number(settings.targetSpeed)) {
        showSpeedToast(settingsTools.clampNumber(message.settings.targetSpeed, settings.minSpeed, settings.maxSpeed, 1));
      }

      applySettings(message.settings);
      sendResponse({ ok: true, settings, status: getStatus() });
      return true;
    }

    if (message.type === "watch-dash:command") {
      handleCommand(message.command);
      sendResponse({ ok: true, settings, status: getStatus() });
      return true;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[storageKey]) {
      return;
    }

    settings = settingsTools.normalize(changes[storageKey].newValue);
    tick();
  });

  document.addEventListener("keydown", handleHotkey, true);
  window.addEventListener("pagehide", flushSettingsPersist);

  const observer = new MutationObserver(scheduleTick);
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: [
      "aria-label",
      "class",
      "data-automation-id",
      "data-test-id",
      "data-testid",
      "data-uia",
      "role",
      "style",
      "title"
    ]
  });

  window.setInterval(tick, 1000);
  loadSettings();

  function showSpeedToast(speed) {
    const toast = getSpeedToast();
    const value = settingsTools.clampNumber(speed, settings.minSpeed, settings.maxSpeed, 1);

    toast.querySelector("[data-watch-dash-speed-value]").textContent = `${value.toFixed(2)}x`;
    toast.classList.add("watch-dash-speed-toast--visible");

    if (speedToastTimer) {
      window.clearTimeout(speedToastTimer);
    }

    speedToastTimer = window.setTimeout(() => {
      toast.classList.remove("watch-dash-speed-toast--visible");
    }, 900);
  }

  function getSpeedToast() {
    let toast = document.getElementById("watch-dash-speed-toast");
    if (toast) {
      return toast;
    }

    injectSpeedToastStyles();
    toast = document.createElement("div");
    toast.id = "watch-dash-speed-toast";
    toast.className = "watch-dash-speed-toast";
    toast.setAttribute("aria-live", "polite");

    const content = document.createElement("div");
    const label = document.createElement("div");
    label.className = "watch-dash-speed-toast__label";
    label.textContent = "Speed";

    const value = document.createElement("div");
    value.className = "watch-dash-speed-toast__value";
    value.dataset.watchDashSpeedValue = "";
    value.textContent = "1.00x";

    content.append(label, value);
    toast.append(content);
    document.documentElement.appendChild(toast);
    return toast;
  }

  function isEditableTarget(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];

    return path.some((node) => {
      if (!node || node === window || node === document) {
        return false;
      }

      const tagName = node.tagName ? node.tagName.toLowerCase() : "";
      return tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        node.isContentEditable ||
        node.getAttribute && node.getAttribute("role") === "textbox";
    });
  }

  function isTrustedSender(sender) {
    return Boolean(sender && sender.id === chrome.runtime.id);
  }

  function injectSpeedToastStyles() {
    if (document.getElementById("watch-dash-speed-toast-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "watch-dash-speed-toast-style";
    style.textContent = `
      .watch-dash-speed-toast {
        position: fixed;
        left: 50%;
        top: 12vh;
        z-index: 2147483647;
        display: grid;
        grid-template-columns: minmax(0, auto);
        align-items: center;
        min-width: 104px;
        padding: 9px 16px 10px;
        border: 1px solid rgba(140, 160, 184, 0.28);
        border-radius: 8px;
        background: rgba(7, 11, 18, 0.92);
        color: #d8e3f2;
        box-shadow: 0 14px 34px rgba(0, 5, 16, 0.44);
        backdrop-filter: blur(10px);
        font: 13px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
        opacity: 0;
        transform: translate(-50%, -8px) scale(0.98);
        transition: opacity 140ms ease, transform 140ms ease;
      }

      .watch-dash-speed-toast--visible {
        opacity: 1;
        transform: translate(-50%, 0) scale(1);
      }

      .watch-dash-speed-toast__label {
        color: #8faeff;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .watch-dash-speed-toast__value {
        margin-top: 1px;
        color: #f4f8ff;
        font-size: 26px;
        font-weight: 900;
        letter-spacing: 0;
        font-variant-numeric: tabular-nums;
      }

    `;
    document.documentElement.appendChild(style);
  }
})(globalThis);
