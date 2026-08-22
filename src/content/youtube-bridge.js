(function watchDashYouTubeBridge(root) {
  if (root.WatchDashYouTubeBridge) {
    return;
  }

  // manifest registration replaced the script-tag handoff; this marker keeps
  // a duplicate registration or stray legacy injection inert
  root.WatchDashYouTubeBridge = Object.freeze({ version: 1 });

  const requestSource = "watch-dash-content";
  const responseSource = "watch-dash-youtube-bridge";
  let bridgeNonce = "";

  const qualityLevels = [
    { height: 4320, level: "highres" },
    { height: 2160, level: "hd2160" },
    { height: 1440, level: "hd1440" },
    { height: 1080, level: "hd1080" },
    { height: 720, level: "hd720" },
    { height: 480, level: "large" },
    { height: 360, level: "medium" },
    { height: 240, level: "small" },
    { height: 144, level: "tiny" },
  ];

  function getPlayer() {
    // shorts pages have no movie_player, so fall through to the first player
    // element that is still attached to the document
    const players = listPlayers();
    return (
      players.find((player) => player.isConnected !== false) ||
      players[0] ||
      null
    );
  }

  function listPlayers() {
    const players = [];
    const primary = document.getElementById("movie_player");

    if (primary) {
      players.push(primary);
    }

    try {
      for (const player of document.querySelectorAll(".html5-video-player")) {
        if (!players.includes(player)) {
          players.push(player);
        }
      }
    } catch (error) {
      // some pages patch dom apis; the movie player lookup still applies
    }

    return players;
  }

  function getAvailableQualityLevels(player) {
    if (!player || typeof player.getAvailableQualityLevels !== "function") {
      return [];
    }

    try {
      return player.getAvailableQualityLevels().filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function getCurrentQuality(player) {
    if (!player || typeof player.getPlaybackQuality !== "function") {
      return null;
    }

    try {
      return player.getPlaybackQuality();
    } catch (error) {
      return null;
    }
  }

  function chooseQualityLevel(targetHeight, availableLevels) {
    const requested = Number(targetHeight);
    const maximumHeight = Number.isFinite(requested) ? requested : 1080;
    const available = new Set(
      (availableLevels || []).filter((level) => level !== "auto"),
    );
    const candidates = qualityLevels.filter((quality) => {
      return available.size === 0 || available.has(quality.level);
    });

    const belowTarget = candidates.find(
      (quality) => quality.height <= maximumHeight,
    );
    if (belowTarget) {
      return belowTarget.level;
    }

    return candidates.length > 0
      ? candidates[candidates.length - 1].level
      : "hd1080";
  }

  function setQuality(targetHeight) {
    const player = getPlayer();
    if (!player) {
      return {
        ok: false,
        error: "player-unavailable",
      };
    }

    const availableLevels = getAvailableQualityLevels(player);
    const targetLevel = chooseQualityLevel(targetHeight, availableLevels);
    let changed = false;

    try {
      if (typeof player.setPlaybackQualityRange === "function") {
        player.setPlaybackQualityRange(targetLevel, targetLevel);
        changed = true;
      }

      if (typeof player.setPlaybackQuality === "function") {
        player.setPlaybackQuality(targetLevel);
        changed = true;
      }
    } catch (error) {
      return {
        ok: false,
        error: "quality-change-failed",
        message: String(error && error.message ? error.message : error),
        availableLevels,
        targetLevel,
        currentLevel: getCurrentQuality(player),
      };
    }

    return {
      ok: changed,
      availableLevels,
      targetLevel,
      currentLevel: getCurrentQuality(player),
    };
  }

  function getStatus() {
    const player = getPlayer();

    return {
      ok: Boolean(player),
      availableLevels: getAvailableQualityLevels(player),
      currentLevel: getCurrentQuality(player),
    };
  }

  function respond(id, payload) {
    root.postMessage(
      Object.assign(
        {
          source: responseSource,
          id,
          nonce: bridgeNonce,
        },
        payload,
      ),
      root.location.origin,
    );
  }

  function respondReady() {
    root.postMessage(
      {
        source: responseSource,
        command: "ready",
        nonce: bridgeNonce,
      },
      root.location.origin,
    );
  }

  root.addEventListener("message", (event) => {
    if (
      event.source !== root ||
      event.origin !== root.location.origin ||
      !event.data ||
      event.data.source !== requestSource
    ) {
      return;
    }

    const message = event.data;

    // the isolated world hands out a closure-scoped session nonce here;
    // later requests and every response must keep echoing it
    if (message.command === "hello") {
      bridgeNonce = typeof message.nonce === "string" ? message.nonce : "";
      respondReady();
      return;
    }

    if (!bridgeNonce || message.nonce !== bridgeNonce) {
      return;
    }

    if (message.command === "set-quality") {
      respond(message.id, setQuality(message.targetHeight));
      return;
    }

    if (message.command === "get-status") {
      respond(message.id, getStatus());
    }
  });

  // announce presence with an empty nonce so a controller that registered
  // first can re-pair instead of waiting out its watchdog
  respondReady();
})(window);
