(function registerWatchDashYouTubeController(root) {
  let bridgeInjected = false;
  let bridgeReady = false;
  let lastQualityRequestAt = 0;
  let lastQualityTarget = null;
  let lastVideoKey = null;
  let qualityStatus = null;
  const bridgeToken = createRequestId();

  const bridgeRequests = new Map();
  const bridgeQueue = [];

  function isYouTubePlatform(platform) {
    return Boolean(platform && platform.id === "youtube");
  }

  function isAdShowing(platform) {
    if (!isYouTubePlatform(platform)) {
      return false;
    }

    return Boolean(document.querySelector(
      ".html5-video-player.ad-showing, .html5-video-player.ad-interrupting, #movie_player.ad-showing, #movie_player.ad-interrupting"
    ));
  }

  function applyQualityTarget(platform, settings) {
    if (!isYouTubePlatform(platform) || !settings.youtubeQualityControls) {
      return;
    }

    const now = Date.now();
    const targetHeight = settings.qualityTargetHeight;
    const videoKey = getVideoKey();

    if (lastQualityTarget === targetHeight &&
      lastVideoKey === videoKey &&
      now - lastQualityRequestAt < 5000) {
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

  function ensureBridge() {
    if (bridgeReady || bridgeInjected || !root.chrome || !root.chrome.runtime || typeof root.chrome.runtime.getURL !== "function") {
      return;
    }

    bridgeInjected = true;
    const script = document.createElement("script");
    script.src = root.chrome.runtime.getURL("src/content/youtube-bridge.js");
    script.async = false;
    script.dataset.watchDashToken = bridgeToken;
    script.onload = () => {
      bridgeReady = true;
      script.remove();
      flushBridgeQueue();
    };
    script.onerror = () => {
      bridgeInjected = false;
      script.remove();
    };
    document.documentElement.appendChild(script);
  }

  function sendBridgeCommand(command, payload, callback) {
    ensureBridge();

    const id = createRequestId();
    const timeout = window.setTimeout(() => {
      bridgeRequests.delete(id);
      qualityStatus = {
        ok: false,
        error: "bridge-timeout"
      };
    }, 1500);

    bridgeRequests.set(id, {
      callback,
      command,
      timeout
    });

    const message = Object.assign({
      source: "watch-dash-content",
      id,
      command,
      token: bridgeToken
    }, payload || {});

    if (bridgeReady) {
      postBridgeMessage(message);
    } else {
      bridgeQueue.push(message);
    }
  }

  function flushBridgeQueue() {
    while (bridgeQueue.length > 0) {
      postBridgeMessage(bridgeQueue.shift());
    }
  }

  function handleBridgeMessage(event) {
    if (event.source !== window ||
      event.origin !== location.origin ||
      !event.data ||
      event.data.source !== "watch-dash-youtube-bridge" ||
      event.data.token !== bridgeToken) {
      return;
    }

    const request = bridgeRequests.get(event.data.id);
    if (!request) {
      return;
    }

    window.clearTimeout(request.timeout);
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
    window.postMessage(message, location.origin);
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
      currentLevel: sanitizeText(data.currentLevel)
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
    isAdShowing,
    getQualityStatus(platform) {
      return isYouTubePlatform(platform) ? qualityStatus : null;
    }
  });
})(globalThis);
