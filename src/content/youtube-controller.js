(function registerWatchDashYouTubeController(root) {
  if (root.WatchDashYouTubeController) {
    return;
  }

  const isVisibleElement =
    root.WatchDashAutomation && root.WatchDashAutomation.isVisibleElement;
  const requestSource = "watch-dash-content";
  const responseSource = "watch-dash-youtube-bridge";
  let bridgeReady = false;
  let bridgeDisabled = false;
  let bridgeHandshakeTimer = null;
  let lastQualityRequestAt = 0;
  let lastQualityTarget = null;
  let lastVideoKey = null;
  let qualityStatus = null;
  const bridgeNonce = createRequestId();
  const adJumpEndPaddingSeconds = 0.25;
  const adJumpMinimumRemainingSeconds = 0.75;
  const maxBridgeQueueLength = 10;
  const bridgeHandshakeTimeoutMs = 5000;
  const bridgeRequestTimeoutMs = 1500;

  // authoritative signal first; a lone visible element must never flip the
  // shared ad state while normal content is playing
  const adPlayerClassSelector =
    ".html5-video-player.ad-showing, .html5-video-player.ad-interrupting, #movie_player.ad-showing, #movie_player.ad-interrupting";
  const adMediaSelector = "#movie_player .video-ads video";
  const adOverlaySelectors = [
    "#movie_player .video-ads .ytp-ad-player-overlay",
    "#movie_player .ytp-ad-player-overlay",
  ];
  const adSkipSelectors = [
    "#movie_player .video-ads .ytp-ad-skip-button",
    "#movie_player .video-ads .ytp-ad-skip-button-modern",
    "#movie_player .video-ads .ytp-skip-ad-button",
    "#movie_player .ytp-ad-skip-button-modern",
    "#movie_player .ytp-skip-ad-button",
  ];
  const maxAdJumpAttempts = 4;

  const bridgeRequests = new Map();
  const bridgeQueue = [];
  const adJumpAttempts = new WeakMap();
  let adProbeResult = false;
  let adProbeResetTimer = null;
  const adProbePending = {};

  function isYouTubePlatform(platform) {
    return Boolean(platform && platform.id === "youtube");
  }

  function isAdShowing(platform) {
    if (!isYouTubePlatform(platform)) {
      return false;
    }

    // dedupe the dom sweeps when one tick asks several times in a row
    if (adProbeResetTimer !== null) {
      return adProbeResult;
    }

    adProbeResult = detectAdShowing();
    scheduleAdProbeReset();
    return adProbeResult;
  }

  function scheduleAdProbeReset() {
    adProbeResetTimer = adProbePending;

    try {
      const handle = window.setTimeout(() => {
        adProbeResetTimer = null;
      }, 0);

      // a synchronous timer already reset the probe, so drop the handle
      if (adProbeResetTimer === adProbePending) {
        adProbeResetTimer = handle;
      }
    } catch (error) {
      adProbeResetTimer = null;
    }
  }

  function detectAdShowing() {
    if (hasPlayerAdClass()) {
      return true;
    }

    // secondary confirmation needs structure that only exists while an ad
    // module is live; preview cards can linger during content playback so
    // they never count on their own
    const adMedia = getAdMedia();
    if (adMedia && isActiveAdMedia(adMedia)) {
      return true;
    }

    return adOverlaySelectors.concat(adSkipSelectors).some(hasVisibleElement);
  }

  function hasPlayerAdClass() {
    try {
      return Boolean(document.querySelector(adPlayerClassSelector));
    } catch (error) {
      return false;
    }
  }

  function getAdMedia() {
    try {
      return document.querySelector(adMediaSelector);
    } catch (error) {
      return null;
    }
  }

  function isActiveAdMedia(video) {
    try {
      return Boolean(video) && (!video.paused || Number(video.currentTime) > 0);
    } catch (error) {
      return false;
    }
  }

  function jumpForwardThroughAd(platform, settings, video) {
    if (
      !isYouTubePlatform(platform) ||
      !settings ||
      !settings.youtubeAutoSkipAds ||
      !isAdShowing(platform) ||
      !canJumpForward(video)
    ) {
      return null;
    }

    const jumpState = adJumpStateFor(video);

    // server-stitched ads ignore client seeks, so stop hammering after a few
    // tries and wait for a fresh creative or video instead
    if (jumpState.attempts >= maxAdJumpAttempts) {
      return null;
    }

    const targetTime = Math.max(0, video.duration - adJumpEndPaddingSeconds);

    try {
      video.currentTime = targetTime;
      jumpState.attempts += 1;
      video.dispatchEvent(new Event("seeking", { bubbles: true }));
      video.dispatchEvent(new Event("timeupdate", { bubbles: true }));
      return "Jump ad";
    } catch (error) {
      return null;
    }
  }

  function adJumpStateFor(video) {
    let state = adJumpAttempts.get(video);
    const signature = adInstanceSignature(video);

    if (!state || state.signature !== signature) {
      state = { signature, attempts: 0 };
      adJumpAttempts.set(video, state);
    }

    return state;
  }

  function adInstanceSignature(video) {
    let duration = "";

    try {
      duration = Number.isFinite(Number(video.duration))
        ? String(Math.round(Number(video.duration)))
        : "";
    } catch (error) {
      duration = "";
    }

    return `${getVideoKeySafely()}|${duration}`;
  }

  function getVideoKeySafely() {
    try {
      return getVideoKey();
    } catch (error) {
      return "";
    }
  }

  function canJumpForward(video) {
    if (
      !video ||
      !Number.isFinite(video.duration) ||
      !Number.isFinite(video.currentTime) ||
      video.duration <= adJumpEndPaddingSeconds ||
      video.duration - video.currentTime < adJumpMinimumRemainingSeconds
    ) {
      return false;
    }

    if (video.seekable && video.seekable.length > 0) {
      const lastRange = video.seekable.length - 1;
      try {
        return (
          video.seekable.end(lastRange) >=
          video.duration - adJumpEndPaddingSeconds
        );
      } catch (error) {
        return true;
      }
    }

    return true;
  }

  function hasVisibleElement(selector) {
    try {
      return (
        typeof isVisibleElement === "function" &&
        Array.from(document.querySelectorAll(selector)).some(isVisibleElement)
      );
    } catch (error) {
      return false;
    }
  }

  function applyQualityTarget(platform, settings) {
    if (!isYouTubePlatform(platform) || !settings.youtubeQualityControls) {
      return;
    }

    const now = Date.now();
    const targetHeight = settings.qualityTargetHeight;
    const videoKey = getVideoKey();

    if (
      lastQualityTarget === targetHeight &&
      lastVideoKey === videoKey &&
      now - lastQualityRequestAt < 5000
    ) {
      return;
    }

    lastQualityTarget = targetHeight;
    lastVideoKey = videoKey;
    lastQualityRequestAt = now;

    sendBridgeCommand("set-quality", { targetHeight }, (response) => {
      qualityStatus = response;
    });
  }

  function getVideoKey() {
    try {
      const url = new URL(location.href);
      return url.searchParams.get("v") || `${url.pathname}${url.search}`;
    } catch (error) {
      return location.href;
    }
  }

  function pingBridge() {
    if (bridgeReady || bridgeDisabled || bridgeHandshakeTimer !== null) {
      return;
    }

    // one handshake probe; a silent bridge stays disabled instead of looping
    bridgeHandshakeTimer = window.setTimeout(() => {
      bridgeHandshakeTimer = null;
      disableBridge("bridge-unavailable");
    }, bridgeHandshakeTimeoutMs);

    window.postMessage(
      {
        source: requestSource,
        command: "hello",
        nonce: bridgeNonce,
      },
      location.origin,
    );
  }

  function clearBridgeHandshakeTimer() {
    if (bridgeHandshakeTimer === null) {
      return;
    }

    window.clearTimeout(bridgeHandshakeTimer);
    bridgeHandshakeTimer = null;
  }

  function markBridgeReady() {
    if (bridgeReady || bridgeDisabled) {
      return;
    }

    clearBridgeHandshakeTimer();
    bridgeReady = true;
    flushBridgeQueue();
  }

  function disableBridge(error) {
    bridgeDisabled = true;
    clearBridgeHandshakeTimer();
    rejectQueuedBridgeCommands(error);
  }

  function sendBridgeCommand(command, payload, callback) {
    pingBridge();

    const id = createRequestId();
    bridgeRequests.set(id, {
      callback,
      command,
      timeout: null,
    });

    const message = Object.assign(
      {
        source: requestSource,
        id,
        command,
        nonce: bridgeNonce,
      },
      payload || {},
    );

    if (bridgeReady) {
      postBridgeMessage(message);
      return;
    }

    if (bridgeDisabled) {
      rejectBridgeRequest(id, "bridge-disabled");
      return;
    }

    trimBridgeQueue();
    bridgeQueue.push(message);
  }

  function trimBridgeQueue() {
    while (bridgeQueue.length >= maxBridgeQueueLength) {
      rejectBridgeRequest(bridgeQueue.shift().id, "bridge-queue-full");
    }
  }

  function rejectQueuedBridgeCommands(error) {
    while (bridgeQueue.length > 0) {
      rejectBridgeRequest(bridgeQueue.shift().id, error);
    }
  }

  function rejectBridgeRequest(id, error) {
    const request = bridgeRequests.get(id);
    removeQueuedBridgeMessage(id);
    if (!request) {
      return;
    }

    if (request.timeout !== null) {
      window.clearTimeout(request.timeout);
    }
    bridgeRequests.delete(id);
    request.callback({
      ok: false,
      id,
      command: request.command,
      error,
    });
  }

  function removeQueuedBridgeMessage(id) {
    const queueIndex = bridgeQueue.findIndex((message) => message.id === id);
    if (queueIndex !== -1) {
      bridgeQueue.splice(queueIndex, 1);
    }
  }

  function flushBridgeQueue() {
    while (bridgeQueue.length > 0) {
      postBridgeMessage(bridgeQueue.shift());
    }
  }

  function handleBridgeMessage(event) {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      !event.data ||
      event.data.source !== responseSource
    ) {
      return;
    }

    if (event.data.command === "ready") {
      if (event.data.nonce === bridgeNonce) {
        markBridgeReady();
      } else if (!bridgeReady) {
        // bridge registered after us or reset; re-establish the session
        pingBridge();
      }
      return;
    }

    if (event.data.nonce !== bridgeNonce) {
      return;
    }

    const request = bridgeRequests.get(event.data.id);
    if (!request) {
      return;
    }

    if (request.timeout !== null) {
      window.clearTimeout(request.timeout);
    }
    bridgeRequests.delete(event.data.id);
    request.callback(sanitizeBridgeResponse(event.data, request.command));
  }

  function createRequestId() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return `watch-dash-${root.crypto.randomUUID()}`;
    }

    const values = new Uint32Array(4);
    if (root.crypto && typeof root.crypto.getRandomValues === "function") {
      root.crypto.getRandomValues(values);
    } else {
      for (let index = 0; index < values.length; index += 1) {
        values[index] = Math.floor(Math.random() * 0xffffffff);
      }
    }

    return `watch-dash-${Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("")}`;
  }

  function postBridgeMessage(message) {
    startBridgeTimeout(message.id);
    window.postMessage(message, location.origin);
  }

  function startBridgeTimeout(id) {
    const request = bridgeRequests.get(id);
    if (!request || request.timeout !== null) {
      return;
    }

    request.timeout = window.setTimeout(() => {
      rejectBridgeRequest(id, "bridge-timeout");
    }, bridgeRequestTimeoutMs);
  }

  function sanitizeBridgeResponse(data, command) {
    return {
      ok: Boolean(data.ok),
      id: String(data.id || ""),
      command,
      error: sanitizeText(data.error),
      message: sanitizeText(data.message),
      availableLevels: sanitizeStringArray(data.availableLevels),
      targetLevel: sanitizeText(data.targetLevel),
      currentLevel: sanitizeText(data.currentLevel),
    };
  }

  function sanitizeStringArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.slice(0, 20).map(sanitizeText).filter(Boolean);
  }

  function sanitizeText(value) {
    if (typeof value !== "string") {
      return null;
    }

    return value.slice(0, 80);
  }

  window.addEventListener("message", handleBridgeMessage);

  root.WatchDashYouTubeController = Object.freeze({
    applyQualityTarget,
    jumpForwardThroughAd,
    isAdShowing,
    getQualityStatus(platform) {
      return isYouTubePlatform(platform) ? qualityStatus : null;
    },
  });
})(globalThis);
