const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function loadScripts(files, extras) {
  const context = Object.assign(
    {
      console,
      setTimeout,
      clearTimeout,
    },
    extras || {},
  );

  context.globalThis = context;
  context.window = context.window || context;
  vm.createContext(context);

  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }

  return context;
}

function testSettingsStorageEnvelope() {
  const context = loadScripts([
    "src/shared/defaults.js",
    "src/shared/settings.js",
  ]);
  const settingsTools = context.WatchDashSettings;

  const normalized = settingsTools.normalize({
    settings: {
      targetSpeed: 99,
      minSpeed: 0.5,
      maxSpeed: 3,
      youtubeAdSpeed: 2.5,
      unknownKey: true,
    },
  });

  assert.strictEqual(normalized.targetSpeed, 3);
  assert.strictEqual(normalized.youtubeAdSpeed, 2.5);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(normalized, "unknownKey"),
    false,
  );
  assert.strictEqual(
    settingsTools.needsStorageMigration({ targetSpeed: 1.5 }),
    true,
  );

  const stored = settingsTools.toStorageValue({ targetSpeed: 1.5 });
  assert.strictEqual(stored.version, context.WatchDashDefaults.version);
  assert.strictEqual(stored.settings.targetSpeed, 1.5);
  assert.strictEqual(settingsTools.needsStorageMigration(stored), false);
  assert.strictEqual(settingsTools.normalize(stored).targetSpeed, 1.5);
  assert.strictEqual(
    Object.isFrozen(context.WatchDashDefaults.defaultSettings),
    true,
  );
  assert.strictEqual(
    settingsTools.normalize({ enabled: 0, hotkeys: "yes" }).enabled,
    false,
  );
  assert.strictEqual(
    settingsTools.normalize({ enabled: 0, hotkeys: "yes" }).hotkeys,
    true,
  );
}

function testAutomationTextFallbackGate() {
  const element = {
    disabled: false,
    value: "",
    textContent: "Resume",
    checkVisibility: () => true,
    closest: () => null,
    getAttribute(name) {
      return name === "aria-label" ? "Resume" : null;
    },
    getBoundingClientRect() {
      return { width: 80, height: 24 };
    },
    querySelectorAll() {
      return [];
    },
  };
  const context = loadScripts(["src/content/automation.js"], {
    document: {
      querySelectorAll(selector) {
        return selector ===
          "button, a, [role='button'], input[type='button'], input[type='submit']"
          ? [element]
          : [];
      },
    },
    getComputedStyle() {
      return { visibility: "visible", display: "block", opacity: "1" };
    },
  });
  const automation = context.WatchDashAutomation;
  const action = { selectors: [], text: ["Resume"] };

  assert.strictEqual(
    automation.findActionTarget(action, { allowTextFallback: false }),
    null,
  );
  assert.strictEqual(
    automation.findActionTarget(action, { allowTextFallback: true }),
    element,
  );
}

function testAutomationTextFallbackCanBeScopedToPlayerRoot() {
  function makeButton(label) {
    return {
      disabled: false,
      value: "",
      textContent: label,
      checkVisibility: () => true,
      closest: () => null,
      getAttribute(name) {
        return name === "aria-label" ? label : null;
      },
      getBoundingClientRect() {
        return { width: 100, height: 32 };
      },
      querySelectorAll() {
        return [];
      },
    };
  }

  const unrelatedResume = makeButton("Resume browsing carousel");
  const playerResume = makeButton("Resume episode");
  const playerRoot = {
    querySelectorAll(selector) {
      return selector ===
        "button, a, [role='button'], input[type='button'], input[type='submit']"
        ? [playerResume]
        : [];
    },
  };
  const context = loadScripts(["src/content/automation.js"], {
    document: {
      querySelectorAll(selector) {
        return selector ===
          "button, a, [role='button'], input[type='button'], input[type='submit']"
          ? [unrelatedResume, playerResume]
          : [];
      },
    },
    getComputedStyle() {
      return { visibility: "visible", display: "block", opacity: "1" };
    },
  });
  const automation = context.WatchDashAutomation;
  const action = { selectors: [], text: ["Resume"] };

  assert.strictEqual(
    automation.findActionTarget(action, {
      allowTextFallback: true,
      textFallbackRoot: playerRoot,
    }),
    playerResume,
  );
  assert.strictEqual(
    automation.findActionTarget(action, {
      allowTextFallback: true,
      textFallbackRoot: null,
    }),
    null,
  );
}

function testAutomationSkipsElementsWithPatchedVisibilityApis() {
  const stableElement = {
    disabled: false,
    value: "",
    textContent: "Resume episode",
    checkVisibility: () => true,
    closest: () => null,
    getAttribute(name) {
      return name === "aria-label" ? "Resume episode" : null;
    },
    getBoundingClientRect() {
      return { width: 100, height: 32 };
    },
    querySelectorAll() {
      return [];
    },
  };
  const patchedElement = {
    disabled: false,
    value: "",
    textContent: "Resume episode",
    checkVisibility: () => true,
    closest: () => null,
    getAttribute(name) {
      return name === "aria-label" ? "Resume episode" : null;
    },
    getBoundingClientRect() {
      throw new Error("patched DOM failure");
    },
    querySelectorAll() {
      return [];
    },
  };
  const context = loadScripts(["src/content/automation.js"], {
    document: {
      querySelectorAll(selector) {
        return selector ===
          "button, a, [role='button'], input[type='button'], input[type='submit']"
          ? [patchedElement, stableElement]
          : [];
      },
    },
    getComputedStyle() {
      return { visibility: "visible", display: "block", opacity: "1" };
    },
  });
  const automation = context.WatchDashAutomation;
  const action = { selectors: [], text: ["Resume"] };

  assert.strictEqual(automation.findActionTarget(action), stableElement);
}

function testAutomationSelectorRootsAndQueryCacheAvoidRepeatedScans() {
  const target = {
    disabled: false,
    value: "",
    textContent: "Skip Intro",
    checkVisibility: () => true,
    closest: () => null,
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return { width: 80, height: 24 };
    },
    querySelectorAll() {
      return [];
    },
  };
  const playerRootQueries = [];
  const documentQueries = [];
  const playerRoot = {
    querySelectorAll(selector) {
      playerRootQueries.push(selector);
      return [];
    },
  };
  const context = loadScripts(["src/content/automation.js"], {
    document: {
      querySelectorAll(selector) {
        documentQueries.push(selector);
        return selector === "button" ? [target] : [];
      },
    },
    getComputedStyle() {
      return { visibility: "visible", display: "block", opacity: "1" };
    },
  });
  const automation = context.WatchDashAutomation;
  const queryCache = new WeakMap();
  const action = { selectors: ["button", "button"], text: [] };

  assert.strictEqual(
    automation.findActionTarget(action, {
      allowTextFallback: false,
      selectorRoots: [playerRoot],
      queryCache,
    }),
    target,
  );
  assert.deepStrictEqual(playerRootQueries, ["button"]);
  assert.deepStrictEqual(documentQueries, ["button"]);

  assert.strictEqual(
    automation.findActionTarget(
      { selectors: ["button"], text: [] },
      {
        allowTextFallback: false,
        selectorRoots: [playerRoot],
        queryCache,
      },
    ),
    target,
  );
  assert.deepStrictEqual(playerRootQueries, ["button"]);
  assert.deepStrictEqual(documentQueries, ["button"]);
}

function testPlatformActionsDedupeSelectorsAtRegistration() {
  const context = loadScripts(["src/content/platforms.js"], {
    document: {
      title: "",
      querySelector() {
        return null;
      },
    },
    location: {
      hostname: "www.amazon.com",
      pathname: "/gp/video/detail/B012345",
    },
  });
  for (const platform of context.WatchDashPlatforms) {
    for (const action of platform.actions) {
      assert.strictEqual(
        new Set(action.selectors).size,
        action.selectors.length,
      );
      assert.strictEqual(new Set(action.text).size, action.text.length);
    }
  }
}

function testContentInitializationPreservesVideoPreload() {
  const video = {
    playbackRate: 1,
    paused: false,
    ended: false,
    preload: "metadata",
    duration: 600,
    currentTime: 10,
    getBoundingClientRect() {
      return { width: 1280, height: 720 };
    },
  };
  let observed = false;

  loadScripts(
    [
      "src/shared/defaults.js",
      "src/shared/settings.js",
      "src/content/watch-dash.js",
    ],
    {
      location: {
        hostname: "example.test",
        pathname: "/watch",
        href: "https://example.test/watch",
      },
      chrome: {
        runtime: {
          lastError: null,
          onMessage: {
            addListener() {},
          },
        },
        storage: {
          sync: {
            get(keys, callback) {
              callback({
                watchDashSettings: {
                  settings: {
                    enabled: true,
                    speedControls: false,
                    qualityDiagnostics: true,
                    youtubeQualityControls: false,
                  },
                },
              });
            },
            set() {},
          },
          onChanged: {
            addListener() {},
          },
        },
      },
      document: {
        addEventListener() {},
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
        documentElement: {
          appendChild() {},
        },
        createElement(tagName) {
          return { tagName, className: "", textContent: "", remove() {} };
        },
      },
      window: {
        addEventListener() {},
        setTimeout() {
          return 1;
        },
        clearTimeout() {},
        setInterval() {},
      },
      MutationObserver: class {
        observe() {
          observed = true;
        }
      },
      WatchDashMedia: {
        findActiveVideo() {
          return video;
        },
        listVideos() {
          return [video];
        },
      },
      WatchDashAutomation: {
        findActionTarget() {
          return null;
        },
        clickTarget() {},
      },
      WatchDashPlatforms: [
        {
          id: "test",
          hostPatterns: ["example.test"],
          actions: [],
        },
      ],
    },
  );

  assert.strictEqual(observed, true);
  assert.strictEqual(video.preload, "metadata");
}

function testContentSchedulerCoalescesMutationsAndScopesObserver() {
  const timeouts = [];
  const observerInstances = [];
  const playerRoot = {
    querySelectorAll() {
      return [];
    },
  };
  const video = {
    playbackRate: 1,
    defaultPlaybackRate: 1,
    paused: false,
    ended: false,
    duration: 600,
    currentTime: 10,
    closest() {
      return playerRoot;
    },
    getBoundingClientRect() {
      return { width: 1280, height: 720 };
    },
  };
  const documentRoot = { appendChild() {} };

  loadScripts(
    [
      "src/shared/defaults.js",
      "src/shared/settings.js",
      "src/content/watch-dash.js",
    ],
    {
      location: {
        hostname: "example.test",
        pathname: "/watch",
        href: "https://example.test/watch",
      },
      chrome: {
        runtime: { lastError: null, onMessage: { addListener() {} } },
        storage: {
          sync: {
            get(keys, callback) {
              callback({});
            },
            set() {},
          },
          onChanged: { addListener() {} },
        },
      },
      document: {
        addEventListener() {},
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
        documentElement: documentRoot,
        createElement(tagName) {
          return { tagName, className: "", textContent: "", remove() {} };
        },
      },
      window: {
        addEventListener() {},
        setTimeout(callback, delay) {
          timeouts.push({ callback, delay });
          return timeouts.length;
        },
        clearTimeout() {},
        setInterval() {},
      },
      MutationObserver: class {
        constructor(callback) {
          this.callback = callback;
          this.targets = [];
          observerInstances.push(this);
        }
        disconnect() {
          this.disconnected = true;
        }
        observe(target) {
          this.targets.push(target);
        }
      },
      WatchDashMedia: {
        findActiveVideo() {
          return video;
        },
        listVideos() {
          return [video];
        },
      },
      WatchDashAutomation: {
        findActionTarget() {
          return null;
        },
        clickElement() {},
      },
      WatchDashPlatforms: [
        { id: "test", hostPatterns: ["example.test"], actions: [] },
      ],
    },
  );

  const observer = observerInstances[0];
  assert.strictEqual(observer.targets[0], documentRoot);
  assert.strictEqual(observer.targets[1], playerRoot);
  observer.callback();
  observer.callback();
  observer.callback();
  assert.strictEqual(timeouts.length, 1);
  assert.strictEqual(timeouts[0].delay, 250);
}

function testOptionalSiteDetectionOnlyOnUnregisteredHosts() {
  function statusFor(host, platform) {
    let onMessage;
    const video = {
      playbackRate: 1,
      defaultPlaybackRate: 1,
      paused: false,
      ended: false,
      duration: 600,
      currentTime: 30,
      getBoundingClientRect() {
        return { width: 1280, height: 720 };
      },
    };
    const context = loadScripts(
      [
        "src/shared/defaults.js",
        "src/shared/settings.js",
        "src/content/watch-dash.js",
      ],
      {
        location: {
          hostname: host,
          pathname: "/watch",
          href: `https://${host}/watch`,
        },
        chrome: {
          runtime: {
            id: "test-extension",
            lastError: null,
            onMessage: {
              addListener(listener) {
                onMessage = listener;
              },
            },
          },
          storage: {
            sync: {
              get(keys, callback) {
                callback({ watchDashSettings: { targetSpeed: 1.5 } });
              },
              set() {},
            },
            onChanged: { addListener() {} },
          },
        },
        document: {
          addEventListener() {},
          documentElement: {},
          visibilityState: "visible",
        },
        window: {
          addEventListener() {},
          setTimeout() { return 1; },
          clearTimeout() {},
          setInterval() {},
        },
        MutationObserver: class {
          observe() {}
        },
        WatchDashMedia: {
          findActiveVideo() { return video; },
          listVideos() { return [video]; },
          getPlaybackQuality() { return null; },
        },
        WatchDashAutomation: {},
        WatchDashPlatforms: [platform],
      },
    );
    let response;
    onMessage(
      { type: "watch-dash:get-status" },
      { id: context.chrome.runtime.id },
      (value) => { response = value; },
    );
    return { status: response.status, rate: video.playbackRate };
  }

  const registered = {
    id: "registered",
    label: "Registered",
    hostPatterns: ["stream.test"],
    detect() { return false; },
    actions: [],
  };
  const optional = statusFor("video.example", registered);
  assert.strictEqual(optional.status.platform, "generic");
  assert.strictEqual(optional.rate, 1.5);

  const rejected = statusFor("stream.test", registered);
  assert.strictEqual(rejected.status.platform, "unknown");
  assert.strictEqual(rejected.rate, 1);

  const local = statusFor("localhost", registered);
  assert.strictEqual(local.status.platform, "unknown");

  const remoteJellyfin = statusFor("media.example", {
    id: "jellyfin",
    label: "Jellyfin",
    hostPatterns: [],
    detect({ host }) { return host === "media.example"; },
    actions: [],
  });
  assert.strictEqual(remoteJellyfin.status.platform, "jellyfin");
}

function testPopupUnknownFrameCountsStayUnavailable() {
  const elements = new Map();
  let ready;
  let poll;
  let frameCounts = { droppedVideoFrames: null, totalVideoFrames: null };
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        dataset: {},
        style: { setProperty() {} },
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute() {},
        querySelector() { return null; },
      });
    }
    return elements.get(id);
  }
  const document = {
    body: { dataset: {} },
    addEventListener(name, listener) {
      if (name === "DOMContentLoaded") ready = listener;
    },
    getElementById: element,
    querySelectorAll() { return []; },
  };
  const chrome = {
    runtime: { lastError: null },
    storage: {
      sync: { get(keys, callback) { callback({}); }, set() {} },
    },
    tabs: {
      query(query, callback) { callback([{ id: 1 }]); },
      sendMessage(id, message, callback) {
        callback({
          ok: true,
          settings: { targetSpeed: 1 },
          status: {
            platform: "test",
            platformLabel: "Test",
            targetSpeed: 1,
            ...frameCounts,
          },
        });
      },
    },
  };
  loadScripts(
    ["src/shared/defaults.js", "src/shared/settings.js", "src/popup/popup.js"],
    {
      document,
      chrome,
      setInterval(callback) { poll = callback; },
      addEventListener() {},
    },
  );
  ready();
  assert.strictEqual(element("framesValue").textContent, "unavailable");
  frameCounts = { droppedVideoFrames: 0, totalVideoFrames: 42 };
  poll();
  assert.strictEqual(element("framesValue").textContent, "0 dropped / 42 total");
}

function testPopupIgnoresOutOfOrderSettingsResponses() {
  const elements = new Map();
  const requests = [];
  let ready;
  let poll;

  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        id,
        dataset: {},
        style: { setProperty() {} },
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener(name, listener) { listeners.set(name, listener); },
        fire(name) { listeners.get(name)(); },
        setAttribute() {},
        querySelector() { return null; },
      });
    }
    return elements.get(id);
  }

  loadScripts(
    ["src/shared/defaults.js", "src/shared/settings.js", "src/popup/popup.js"],
    {
      document: {
        body: { dataset: {} },
        addEventListener(name, listener) {
          if (name === "DOMContentLoaded") ready = listener;
        },
        getElementById: element,
        querySelectorAll() { return []; },
      },
      chrome: {
        runtime: { lastError: null },
        storage: {
          sync: { get(keys, callback) { callback({}); }, set() {} },
        },
        tabs: {
          query(query, callback) { callback([{ id: 1 }]); },
          sendMessage(id, message, callback) {
            requests.push({ message, callback });
          },
        },
      },
      setInterval(callback) { poll = callback; },
      addEventListener() {},
    },
  );

  function respond(index, targetSpeed) {
    requests[index].callback({
      ok: true,
      settings: { targetSpeed },
      status: { platform: "test", platformLabel: "Test", targetSpeed },
    });
  }

  ready();
  element("speed").value = "1.5";
  element("speed").fire("input");
  poll();
  element("speed").value = "2";
  element("speed").fire("input");

  respond(3, 2);
  respond(0, 1);
  respond(1, 1.5);
  respond(2, 1.5);
  assert.strictEqual(element("speed").value, 2);

  poll();
  respond(4, 2);
  assert.strictEqual(element("speed").value, 2);

  element("speed").value = "2.5";
  element("speed").fire("input");
  requests[5].callback(undefined);
  poll();
  respond(6, 1.75);
  assert.strictEqual(element("speed").value, 1.75);
}

function testYouTubeBridgeRegistrationHandshakeAndOriginGuard() {
  const listeners = [];
  const responses = [];
  const calls = [];
  const pageWindow = {
    location: {
      origin: "https://www.youtube.com",
    },
    addEventListener(type, callback) {
      if (type === "message") {
        listeners.push(callback);
      }
    },
    postMessage(payload, targetOrigin) {
      responses.push({ payload, targetOrigin });
    },
  };
  const player = {
    getAvailableQualityLevels() {
      return ["hd1080", "hd720", "large"];
    },
    getPlaybackQuality() {
      return "auto";
    },
    setPlaybackQualityRange(min, max) {
      calls.push(["range", min, max]);
    },
    setPlaybackQuality(level) {
      calls.push(["set", level]);
    },
  };
  const context = loadScripts(["src/content/youtube-bridge.js"], {
    document: {
      getElementById(id) {
        return id === "movie_player" ? player : null;
      },
      querySelector() {
        return null;
      },
    },
    window: pageWindow,
  });

  assert.strictEqual(context.window, pageWindow);
  assert.strictEqual(listeners.length, 1);

  // manifest registration is idempotent; a duplicate or legacy run of the
  // same file must not stack a second listener
  const bridgeSource = fs.readFileSync(
    path.join(root, "src/content/youtube-bridge.js"),
    "utf8",
  );
  vm.runInContext(bridgeSource, context);
  assert.strictEqual(listeners.length, 1);

  // installation announces an unpaired bridge without claiming a nonce
  assert.strictEqual(responses.length, 1);
  assert.strictEqual(responses[0].targetOrigin, "https://www.youtube.com");
  assert.strictEqual(responses[0].payload.command, "ready");
  assert.strictEqual(responses[0].payload.nonce, "");

  // cross-origin hellos are dropped before any pairing happens
  listeners[0]({
    source: pageWindow,
    origin: "https://attacker.example",
    data: {
      source: "watch-dash-content",
      command: "hello",
      nonce: "evil-nonce",
    },
  });
  assert.strictEqual(responses.length, 1);

  // the handshake hands over the session nonce and it must be echoed
  listeners[0]({
    source: pageWindow,
    origin: "https://www.youtube.com",
    data: {
      source: "watch-dash-content",
      command: "hello",
      nonce: "session-nonce",
    },
  });
  assert.strictEqual(responses.length, 2);
  assert.strictEqual(responses[1].payload.command, "ready");
  assert.strictEqual(responses[1].payload.nonce, "session-nonce");

  // paired sessions still ignore cross-origin senders
  listeners[0]({
    source: pageWindow,
    origin: "https://attacker.example",
    data: {
      source: "watch-dash-content",
      id: "spoof",
      command: "set-quality",
      nonce: "session-nonce",
      targetHeight: 480,
    },
  });
  assert.strictEqual(responses.length, 2);
  assert.deepStrictEqual(calls, []);

  // commands bearing a stale nonce never reach the player either
  listeners[0]({
    source: pageWindow,
    origin: "https://www.youtube.com",
    data: {
      source: "watch-dash-content",
      id: "stale",
      command: "set-quality",
      nonce: "expired-nonce",
      targetHeight: 720,
    },
  });
  assert.strictEqual(responses.length, 2);
  assert.deepStrictEqual(calls, []);

  listeners[0]({
    source: pageWindow,
    origin: "https://www.youtube.com",
    data: {
      source: "watch-dash-content",
      id: "quality-1",
      command: "set-quality",
      nonce: "session-nonce",
      targetHeight: 720,
    },
  });

  assert.deepStrictEqual(calls, [
    ["range", "hd720", "hd720"],
    ["set", "hd720"],
  ]);
  assert.strictEqual(responses.length, 3);
  assert.strictEqual(responses[2].targetOrigin, "https://www.youtube.com");
  assert.strictEqual(responses[2].payload.id, "quality-1");
  assert.strictEqual(responses[2].payload.nonce, "session-nonce");
  assert.strictEqual(responses[2].payload.targetLevel, "hd720");
}

function testYouTubeSelectorsFromPlayerProbe() {
  const context = loadScripts(["src/content/platforms.js"], {
    document: {
      querySelector() {
        return null;
      },
    },
    location: {
      hostname: "www.youtube.com",
      pathname: "/watch",
    },
  });
  const youtube = context.WatchDashPlatforms.find(
    (platform) => platform.id === "youtube",
  );
  const skipAd = youtube.actions.find((action) => action.id === "skip-ad");
  const nextVideo = youtube.actions.find(
    (action) => action.id === "next-video",
  );

  assert(
    skipAd.selectors.includes(
      "#movie_player .video-ads button.ytp-ad-skip-button-modern",
    ),
  );
  assert(
    skipAd.selectors.includes(
      "#movie_player .ytp-ad-skip-button-container button",
    ),
  );
  assert(
    nextVideo.selectors.includes(
      "#movie_player a.ytp-autonav-endscreen-upnext-play-button[role='button']",
    ),
  );
  assert(
    nextVideo.selectors.includes("#movie_player button.ytp-endscreen-next"),
  );
  assert.strictEqual(nextVideo.minProgressBeforeEnded, 0.985);
  assert.strictEqual(nextVideo.maxRemainingSecondsBeforeEnded, 8);
  assert.strictEqual(nextVideo.controlLabel, "Next Video");

  const netflix = context.WatchDashPlatforms.find(
    (platform) => platform.id === "netflix",
  );
  assert.strictEqual(
    netflix.actions.find((action) => action.id === "skip-intro").controlLabel,
    "Intros",
  );
}

function testPrimeVideoDetectorAvoidsGeneralAmazonPages() {
  const context = loadScripts(["src/content/platforms.js"], {
    document: {
      querySelector() {
        return null;
      },
    },
    location: {
      hostname: "www.amazon.com",
      pathname: "/",
    },
  });
  const primeVideo = context.WatchDashPlatforms.find(
    (platform) => platform.id === "prime-video",
  );

  assert(primeVideo.hostPatterns.includes("primevideo.com"));
  assert(primeVideo.hostPatterns.includes("amazon.com"));
  assert.strictEqual(
    primeVideo.detect({ host: "www.amazon.com", path: "/" }),
    false,
  );
  assert.strictEqual(
    primeVideo.detect({ host: "www.amazon.com", path: "/s?k=headphones" }),
    false,
  );
  assert.strictEqual(
    primeVideo.detect({
      host: "www.amazon.com",
      path: "/gp/video/detail/B012345",
    }),
    true,
  );
  assert.strictEqual(
    primeVideo.detect({
      host: "www.amazon.co.uk",
      path: "/video/detail/B012345",
    }),
    true,
  );
  assert.strictEqual(
    primeVideo.detect({ host: "watch.primevideo.com", path: "/detail/0ABC" }),
    true,
  );
}

function testYouTubeAdOverlayDetectionAndJumpFallback() {
  const visibleElement = {
    checkVisibility: () => true,
    getBoundingClientRect() {
      return { width: 120, height: 32 };
    },
  };
  const dispatchedEvents = [];
  let adSignal = "none";
  const context = loadScripts(
    ["src/content/automation.js", "src/content/youtube-controller.js"],
    {
      document: {
        querySelector(selector) {
          if (adSignal === "class" && selector.includes("ad-showing")) {
            return {};
          }
          return null;
        },
        querySelectorAll(selector) {
          if (
            adSignal === "skip-button" &&
            selector.includes("ytp-ad-skip-button")
          ) {
            return [visibleElement];
          }

          if (
            adSignal === "preview" &&
            selector.includes("ytp-ad-preview-container")
          ) {
            return [visibleElement];
          }

          return [];
        },
      },
      window: {
        addEventListener() {},
        setTimeout(callback) {
          callback();
          return 1;
        },
        clearTimeout() {},
      },
      getComputedStyle() {
        return { visibility: "visible", display: "block", opacity: "1" };
      },
      Event: class {
        constructor(type, init) {
          this.type = type;
          this.bubbles = Boolean(init && init.bubbles);
        }
      },
    },
  );
  const controller = context.WatchDashYouTubeController;
  const platform = { id: "youtube" };
  const video = {
    currentTime: 3,
    duration: 12,
    seekable: {
      length: 1,
      end() {
        return 12;
      },
    },
    dispatchEvent(event) {
      dispatchedEvents.push(event.type);
    },
  };

  assert.strictEqual(controller.isAdShowing(platform), false);

  // a lingering preview card during content playback must not flip ad state
  adSignal = "preview";
  assert.strictEqual(controller.isAdShowing(platform), false);

  adSignal = "skip-button";
  assert.strictEqual(controller.isAdShowing(platform), true);
  assert.strictEqual(
    controller.jumpForwardThroughAd(
      platform,
      { youtubeAutoSkipAds: false },
      video,
    ),
    null,
  );
  assert.strictEqual(video.currentTime, 3);
  assert.strictEqual(
    controller.jumpForwardThroughAd(
      platform,
      { youtubeAutoSkipAds: true },
      video,
    ),
    "Jump ad",
  );
  assert.strictEqual(video.currentTime, 11.75);
  assert.deepStrictEqual(dispatchedEvents, ["seeking", "timeupdate"]);

  // server-stitched ads ignore seeks; the jump fallback must stop retrying
  const stitchedVideo = {
    currentTime: 5,
    duration: 30,
    seekable: { length: 0 },
    dispatchEvent() {},
  };
  let jumpAttempts = 0;
  while (
    jumpAttempts < 10 &&
    controller.jumpForwardThroughAd(
      platform,
      { youtubeAutoSkipAds: true },
      stitchedVideo,
    ) === "Jump ad"
  ) {
    jumpAttempts += 1;
    stitchedVideo.currentTime = 5;
  }
  assert.strictEqual(jumpAttempts, 4);
  assert.strictEqual(stitchedVideo.currentTime, 5);

  adSignal = "class";
  assert.strictEqual(controller.isAdShowing(platform), true);
}

function makeYouTubeControllerHarness() {
  const harness = {
    context: null,
    controller: null,
    listeners: [],
    outbound: [],
    timeouts: [],
    createElementCalls: 0,
  };
  harness.context = loadScripts(["src/content/youtube-controller.js"], {
    document: {
      createElement(tagName) {
        harness.createElementCalls += 1;
        return { tagName, dataset: {}, remove() {} };
      },
      documentElement: { appendChild() {} },
    },
    location: {
      href: "https://www.youtube.com/watch?v=test",
      origin: "https://www.youtube.com",
    },
    window: {
      addEventListener(type, callback) {
        if (type === "message") {
          harness.listeners.push(callback);
        }
      },
      clearTimeout(id) {
        harness.timeouts[id].cleared = true;
      },
      postMessage(payload, targetOrigin) {
        harness.outbound.push({ payload, targetOrigin });
      },
      setTimeout(callback, delay) {
        harness.timeouts.push({ callback, delay, cleared: false });
        return harness.timeouts.length - 1;
      },
    },
  });
  harness.controller = harness.context.WatchDashYouTubeController;

  return harness;
}

function testYouTubeBridgeQueueWaitsForHandshakeAndFailsClosed() {
  const platform = { id: "youtube" };
  const settings = {
    youtubeQualityControls: true,
    qualityTargetHeight: 720,
  };

  const live = makeYouTubeControllerHarness();
  live.controller.applyQualityTarget(platform, settings);

  // manifest registration replaced script-tag injection entirely
  assert.strictEqual(live.createElementCalls, 0);

  // the handshake probe carries a closure-scoped session nonce
  assert.strictEqual(live.outbound.length, 1);
  assert.strictEqual(live.outbound[0].payload.source, "watch-dash-content");
  assert.strictEqual(live.outbound[0].payload.command, "hello");
  assert.strictEqual(typeof live.outbound[0].payload.nonce, "string");

  // queued commands stay timer-free until the bridge confirms readiness
  assert.strictEqual(live.timeouts.length, 1);
  assert.strictEqual(live.timeouts[0].delay, 5000);
  assert.strictEqual(live.controller.getQualityStatus(platform), null);

  live.listeners[0]({
    source: live.context.window,
    origin: "https://www.youtube.com",
    data: {
      source: "watch-dash-youtube-bridge",
      command: "ready",
      nonce: live.outbound[0].payload.nonce,
    },
  });

  assert.strictEqual(live.timeouts[0].cleared, true);

  // readiness flushes the queue and only then arms the request timeout
  assert.strictEqual(live.outbound.length, 2);
  assert.strictEqual(live.outbound[1].payload.command, "set-quality");
  assert.strictEqual(
    live.outbound[1].payload.nonce,
    live.outbound[0].payload.nonce,
  );
  assert.strictEqual(live.timeouts.length, 2);
  assert.strictEqual(live.timeouts[1].delay, 1500);
  assert.strictEqual(live.controller.getQualityStatus(platform), null);

  live.timeouts[1].callback();

  const status = live.controller.getQualityStatus(platform);
  assert.strictEqual(status.ok, false);
  assert.strictEqual(status.command, "set-quality");
  assert.strictEqual(status.error, "bridge-timeout");

  // a bridge that never acks trips the watchdog once and fails closed
  const dead = makeYouTubeControllerHarness();
  dead.controller.applyQualityTarget(platform, settings);
  assert.strictEqual(dead.outbound.length, 1);
  assert.strictEqual(dead.timeouts.length, 1);

  dead.timeouts[0].callback();

  const failedStatus = dead.controller.getQualityStatus(platform);
  assert.strictEqual(failedStatus.ok, false);
  assert.strictEqual(failedStatus.command, "set-quality");
  assert.strictEqual(failedStatus.error, "bridge-unavailable");

  // later work is rejected up front instead of probing forever
  dead.controller.applyQualityTarget(platform, {
    ...settings,
    qualityTargetHeight: 1080,
  });
  assert.strictEqual(dead.outbound.length, 1);
  assert.strictEqual(dead.timeouts.length, 1);
  const disabledStatus = dead.controller.getQualityStatus(platform);
  assert.strictEqual(disabledStatus.ok, false);
  assert.strictEqual(disabledStatus.error, "bridge-disabled");
}

function makeVideo({ paused, ended, width, height }) {
  return {
    paused,
    ended,
    getBoundingClientRect() {
      return { width, height };
    },
  };
}

function testActiveVideoSelectionUsesScorePriority() {
  const endedSmall = makeVideo({
    paused: false,
    ended: true,
    width: 320,
    height: 180,
  });
  const pausedLarge = makeVideo({
    paused: true,
    ended: false,
    width: 1600,
    height: 900,
  });
  const playingSmall = makeVideo({
    paused: false,
    ended: false,
    width: 320,
    height: 180,
  });
  const playingLarge = makeVideo({
    paused: false,
    ended: false,
    width: 1280,
    height: 720,
  });
  const videos = [endedSmall, pausedLarge, playingSmall, playingLarge];
  const context = loadScripts(["src/content/media.js"], {
    document: {
      querySelectorAll(selector) {
        return selector === "video" ? videos : [];
      },
    },
  });

  assert.strictEqual(context.WatchDashMedia.findActiveVideo(), playingLarge);
}

function testActiveVideoSelectionPreservesFirstTie() {
  const first = makeVideo({
    paused: false,
    ended: false,
    width: 640,
    height: 360,
  });
  const second = makeVideo({
    paused: false,
    ended: false,
    width: 640,
    height: 360,
  });
  const context = loadScripts(["src/content/media.js"], {
    document: {
      querySelectorAll(selector) {
        return selector === "video" ? [first, second] : [];
      },
    },
  });

  assert.strictEqual(context.WatchDashMedia.findActiveVideo(), first);
}

function testValidatorLoopbackExemptionCoversIpv6LoopbackOnly() {
  const {
    extractManifestHost,
    normalizeHost,
  } = require("./validate-extension");

  // ipv6 loopback installs are detector-based, so they stay exempt from
  // registry host parity exactly like localhost/127.x
  assert.strictEqual(normalizeHost("::1"), "");
  assert.strictEqual(normalizeHost("[::1]"), "");
  assert.strictEqual(extractManifestHost("http://[::1]/web/index.html"), "");

  // non-loopback ipv6 must remain subject to registry parity checks
  for (const host of ["::2", "[::2]", "fe80::", "fe80::1", "2001:db8::1"]) {
    assert.notStrictEqual(
      normalizeHost(host),
      "",
      `${host} must not be exempt.`,
    );
  }

  // every current acceptance and rejection case stays as-is
  assert.strictEqual(normalizeHost(""), "");
  assert.strictEqual(normalizeHost("localhost"), "");
  assert.strictEqual(normalizeHost("127.0.0.1"), "");
  assert.strictEqual(normalizeHost("*.youtube.com"), "youtube.com");
  assert.strictEqual(normalizeHost("netflix.com"), "netflix.com");
}

function testPopupStatusLiveRegionStructure() {
  const popupHtml = fs.readFileSync(
    path.join(root, "src/popup/popup.html"),
    "utf8",
  );
  const statusSectionMatch = popupHtml.match(
    /<section\b[^>]*\bclass="[^"]*\bstatus\b[^"]*\bpanel\b[^"]*"[^>]*>/,
  );
  const liveRegionMatch = popupHtml.match(
    /<div[^>]+id="statusLiveRegion"[^>]*>/,
  );
  const framesRowMatch = popupHtml.match(/<div[^>]+id="frames"[^>]*>/);

  assert(statusSectionMatch, "Playback status section should exist.");
  assert(
    !/aria-live=/.test(statusSectionMatch[0]),
    "The whole status panel must not be a live region.",
  );
  assert(liveRegionMatch, "A dedicated status live region should exist.");
  assert(
    /\bclass="[^"]*\bsr-only\b[^"]*"/.test(liveRegionMatch[0]),
    "The status live region should be visually hidden.",
  );
  assert(
    /aria-live="polite"/.test(liveRegionMatch[0]),
    "The status live region should be polite.",
  );
  assert(
    /aria-atomic="true"/.test(liveRegionMatch[0]),
    "The status live region should announce complete updates.",
  );
  assert(framesRowMatch, "Frame diagnostics row should exist.");
  assert(
    !/aria-live=/.test(framesRowMatch[0]),
    "Frame diagnostics must not be live-announced every second.",
  );
}

function loadSettingsTools() {
  const context = loadScripts([
    "src/shared/defaults.js",
    "src/shared/settings.js",
  ]);
  return context;
}

function testDefaultsContract() {
  const context = loadSettingsTools();
  const defaults = context.WatchDashDefaults;

  assert.deepStrictEqual(
    { ...defaults.defaultSettings },
    {
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
      hotkeys: true,
    },
    "default settings values drifted; update this contract deliberately.",
  );
  assert.strictEqual(defaults.storageKey, "watchDashSettings");
  assert.strictEqual(defaults.version, 1);
  assert.strictEqual(Object.isFrozen(defaults), true);
  assert.strictEqual(Object.isFrozen(defaults.defaultSettings), true);
}

function testNormalizeWithoutInputReturnsAllDefaults() {
  const { WatchDashSettings: tools, WatchDashDefaults: defaults } =
    loadSettingsTools();

  for (const emptyInput of [null, undefined, "garbage", 42]) {
    assert.deepStrictEqual(
      { ...tools.normalize(emptyInput) },
      { ...defaults.defaultSettings },
      `normalize(${String(emptyInput)}) should produce the default settings.`,
    );
  }
}

function testSpeedClampBoundaries() {
  const tools = loadSettingsTools().WatchDashSettings;

  // hard limits are 0.25x to 16x
  assert.strictEqual(tools.normalize({ minSpeed: 0 }).minSpeed, 0.25);
  assert.strictEqual(tools.normalize({ minSpeed: -4 }).minSpeed, 0.25);
  assert.strictEqual(tools.normalize({ minSpeed: 0.25 }).minSpeed, 0.25);
  assert.strictEqual(tools.normalize({ minSpeed: 16 }).minSpeed, 16);
  assert.strictEqual(tools.normalize({ minSpeed: 99 }).minSpeed, 16);
  assert.strictEqual(tools.normalize({ maxSpeed: 0.1 }).maxSpeed, 0.25);
  assert.strictEqual(tools.normalize({ maxSpeed: 16 }).maxSpeed, 16);
  assert.strictEqual(tools.normalize({ maxSpeed: 9999 }).maxSpeed, 16);

  // target speed follows the effective bounds
  assert.strictEqual(tools.normalize({ targetSpeed: 99 }).targetSpeed, 16);
  assert.strictEqual(tools.normalize({ targetSpeed: 0 }).targetSpeed, 0.25);
  assert.strictEqual(tools.normalize({ targetSpeed: 16 }).targetSpeed, 16);
  assert.strictEqual(
    tools.normalize({ targetSpeed: 12, maxSpeed: 4 }).targetSpeed,
    4,
  );
  assert.strictEqual(
    tools.normalize({ targetSpeed: 0.01, minSpeed: 0.5 }).targetSpeed,
    0.5,
  );

  // values round to two decimals before clamping
  assert.strictEqual(tools.normalize({ targetSpeed: 1.234 }).targetSpeed, 1.23);
  assert.strictEqual(tools.normalize({ targetSpeed: 1.236 }).targetSpeed, 1.24);
  assert.strictEqual(tools.normalize({ minSpeed: 0.249 }).minSpeed, 0.25);
}

function testNonNumericSpeedsFallBackToDefaults() {
  const tools = loadSettingsTools().WatchDashSettings;

  assert.strictEqual(tools.normalize({ targetSpeed: "abc" }).targetSpeed, 1);
  assert.strictEqual(tools.normalize({ targetSpeed: NaN }).targetSpeed, 1);
  // Infinity fails the finite check instead of clamping to the max
  assert.strictEqual(tools.normalize({ targetSpeed: Infinity }).targetSpeed, 1);
  assert.strictEqual(tools.normalize({ minSpeed: undefined }).minSpeed, 0.25);
  assert.strictEqual(tools.normalize({ maxSpeed: "nope" }).maxSpeed, 16);

  // numeric strings are accepted
  assert.strictEqual(tools.normalize({ targetSpeed: "2" }).targetSpeed, 2);
  assert.strictEqual(tools.normalize({ minSpeed: "0.5" }).minSpeed, 0.5);
}

function testInvertedSpeedBoundsResetBeforeTargetClamp() {
  const tools = loadSettingsTools().WatchDashSettings;

  const inverted = tools.normalize({
    minSpeed: 10,
    maxSpeed: 2,
    targetSpeed: 8,
  });
  assert.strictEqual(inverted.minSpeed, 0.25);
  assert.strictEqual(inverted.maxSpeed, 16);
  assert.strictEqual(inverted.targetSpeed, 8);
}

function testDependentClampsFollowEffectiveBounds() {
  const tools = loadSettingsTools().WatchDashSettings;

  assert.strictEqual(tools.normalize({ youtubeAdSpeed: 0 }).youtubeAdSpeed, 1);
  assert.strictEqual(
    tools.normalize({ maxSpeed: 8, youtubeAdSpeed: 99 }).youtubeAdSpeed,
    8,
  );
  assert.strictEqual(
    tools.normalize({ youtubeAdSpeed: 99 }).youtubeAdSpeed,
    16,
  );

  assert.strictEqual(tools.normalize({ speedStep: 0.001 }).speedStep, 0.01);
  assert.strictEqual(tools.normalize({ speedStep: 5 }).speedStep, 1);
  assert.strictEqual(tools.normalize({ speedStep: 0.05 }).speedStep, 0.05);

  assert.strictEqual(
    tools.normalize({ clickCooldownMs: 100 }).clickCooldownMs,
    500,
  );
  assert.strictEqual(
    tools.normalize({ clickCooldownMs: 20000 }).clickCooldownMs,
    10000,
  );
  assert.strictEqual(
    tools.normalize({ clickCooldownMs: 1600 }).clickCooldownMs,
    1600,
  );
}

function testCoerceBooleanTextTable() {
  const tools = loadSettingsTools().WatchDashSettings;

  for (const text of ["", "   ", "false", "FALSE", "False", "0", "off", "no"]) {
    assert.strictEqual(
      tools.coerceBoolean(text),
      false,
      `coerceBoolean(${JSON.stringify(text)}) should be false.`,
    );
  }

  for (const value of [
    "yes",
    "true",
    "1",
    "on",
    1,
    {},
    [],
    null,
    undefined,
    0,
  ]) {
    assert.strictEqual(
      tools.coerceBoolean(value),
      Boolean(value),
      `coerceBoolean(${String(value)}) should match Boolean() coercion.`,
    );
  }
}

function testQualityTargetSnappingAndFormatting() {
  const tools = loadSettingsTools().WatchDashSettings;

  assert.deepStrictEqual(
    [...tools.qualityTargets],
    [480, 720, 1080, 1440, 2160],
  );
  assert.strictEqual(Object.isFrozen(tools.qualityTargets), true);

  assert.strictEqual(tools.clampQualityTarget(1080), 1080);
  assert.strictEqual(tools.clampQualityTarget(700), 720);
  assert.strictEqual(tools.clampQualityTarget(1500), 1440);
  assert.strictEqual(tools.clampQualityTarget(300), 480);
  assert.strictEqual(tools.clampQualityTarget(9999), 2160);
  // equidistant targets keep the lower rung
  assert.strictEqual(tools.clampQualityTarget(600), 480);
  assert.strictEqual(tools.clampQualityTarget("abc"), 1080);

  assert.strictEqual(tools.qualityTargetText(2160), "4K");
  assert.strictEqual(tools.qualityTargetText(3840), "4K");
  assert.strictEqual(tools.qualityTargetText(1076), "1080p");
  assert.strictEqual(tools.qualityTargetText("abc"), "1080p");

  assert.strictEqual(tools.qualityTargetIndex(-100), 0);
  assert.strictEqual(tools.qualityTargetIndex(600), 0);
  assert.strictEqual(tools.qualityTargetIndex(700), 1);
  assert.strictEqual(tools.qualityTargetIndex(2160), 4);
  assert.strictEqual(tools.qualityTargetIndex("abc"), 2);

  const normalized = tools.normalize({ qualityTargetHeight: 900 });
  // 900 sits between 720 and 1080; ties keep the lower rung
  assert.strictEqual(normalized.qualityTargetHeight, 720);
}

function testParseImportedSettingsEnvelopeAndErrors() {
  const tools = loadSettingsTools().WatchDashSettings;
  const envelope = JSON.stringify({
    watchDashSettings: { settings: { targetSpeed: 50 } },
  });

  const imported = tools.parseImportedSettings(envelope);
  assert.strictEqual(imported.targetSpeed, 16);
  assert.strictEqual(imported.enabled, true);

  const plain = tools.parseImportedSettings('{"skipIntros":"false"}');
  assert.strictEqual(plain.skipIntros, false);

  assert.throws(
    () => tools.parseImportedSettings(""),
    /paste exported watchdash settings/i,
  );
  assert.throws(
    () => tools.parseImportedSettings("   "),
    /paste exported watchdash settings/i,
  );
  assert.throws(
    () => tools.parseImportedSettings("{invalid json"),
    /not valid json/i,
  );
  assert.throws(
    () => tools.parseImportedSettings("[1, 2]"),
    /expected a json object/i,
  );
  assert.throws(
    () => tools.parseImportedSettings('{"totally": "unrelated"}'),
    /no watchdash settings were found/i,
  );
}

function testExportRoundTripStripsUnknownKeys() {
  const tools = loadSettingsTools().WatchDashSettings;

  const parsed = JSON.parse(
    tools.toExportText({ targetSpeed: 2, mysteryKey: "gone" }),
  );
  assert.strictEqual(parsed.version, 1);
  assert.strictEqual(parsed.settings.targetSpeed, 2);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(parsed.settings, "mysteryKey"),
    false,
  );
  assert.strictEqual(tools.needsStorageMigration(parsed), false);
}

function testSettingsPayloadAndMigrationGuards() {
  const tools = loadSettingsTools().WatchDashSettings;

  assert.strictEqual(tools.isSettingsPayload({ enabled: true }), true);
  assert.strictEqual(tools.isSettingsPayload({ unknownKey: 1 }), false);
  assert.strictEqual(tools.isSettingsPayload({}), false);
  assert.strictEqual(tools.isSettingsPayload(null), false);
  assert.strictEqual(tools.isSettingsPayload("enabled=true"), false);
  assert.strictEqual(tools.isSettingsPayload([]), false);

  assert.strictEqual(tools.needsStorageMigration(null), true);
  assert.strictEqual(tools.needsStorageMigration(undefined), true);
  assert.strictEqual(tools.needsStorageMigration("nope"), true);
  assert.strictEqual(tools.needsStorageMigration({ version: 1 }), true);
  assert.strictEqual(
    tools.needsStorageMigration({ version: 2, settings: {} }),
    true,
  );
  assert.strictEqual(
    tools.needsStorageMigration({ version: 1, settings: {} }),
    false,
  );
}

function makeJellyfinDoc({
  meta = false,
  asset = false,
  title = "",
  dataAttr = false,
  classAttr = false,
} = {}) {
  return {
    title,
    querySelector(selector) {
      if (
        selector.includes("application-name") ||
        selector.includes("apple-mobile-web-app-title")
      ) {
        return meta ? {} : null;
      }

      if (/^(?:link|script)\[/.test(selector)) {
        return asset ? {} : null;
      }

      if (selector.includes("data-app-name")) {
        return dataAttr ? {} : null;
      }

      if (selector.includes("[class*=")) {
        return classAttr ? {} : null;
      }

      return null;
    },
  };
}

function testJellyfinDetectorSignalGating() {
  const context = loadScripts(["src/content/platforms.js"], {
    document: {
      title: "",
      querySelector() {
        return null;
      },
    },
    location: {
      hostname: "media.example.com",
      pathname: "/",
    },
  });
  const jellyfin = context.WatchDashPlatforms.find(
    (platform) => platform.id === "jellyfin",
  );

  // remote hosts must carry the jellyfin app-shell marker
  assert.strictEqual(
    jellyfin.detect({
      host: "media.example.com",
      path: "/",
      document: makeJellyfinDoc({ meta: true, title: "jellyfin" }),
    }),
    true,
  );
  assert.strictEqual(
    jellyfin.detect({
      host: "media.example.com",
      path: "/web/",
      document: makeJellyfinDoc({
        title: "jellyfin web",
        classAttr: true,
      }),
    }),
    false,
  );

  // loopback installs accept any two corroborating signals
  assert.strictEqual(
    jellyfin.detect({
      host: "localhost",
      path: "/web/index.html",
      document: makeJellyfinDoc({ title: "jellyfin" }),
    }),
    true,
  );
  assert.strictEqual(
    jellyfin.detect({
      host: "127.0.0.1",
      path: "/jellyfin/",
      document: makeJellyfinDoc({ asset: true }),
    }),
    true,
  );
  assert.strictEqual(
    jellyfin.detect({
      host: "[::1]",
      path: "/web/",
      document: makeJellyfinDoc({ dataAttr: true, classAttr: true }),
    }),
    true,
  );

  // single signals stay inert everywhere
  for (const host of ["localhost", "media.example.com"]) {
    assert.strictEqual(
      jellyfin.detect({
        host,
        path: "/",
        document: makeJellyfinDoc({ title: "jellyfin" }),
      }),
      false,
      `a lone title signal should not activate jellyfin on ${host}.`,
    );
  }

  assert.strictEqual(
    jellyfin.detect({
      host: "localhost",
      path: "/",
      document: makeJellyfinDoc(),
    }),
    false,
  );
}

function testPrimeVideoDetectorHostNormalization() {
  const context = loadScripts(["src/content/platforms.js"], {
    document: {
      querySelector() {
        return null;
      },
    },
    location: {
      hostname: "www.amazon.com",
      pathname: "/",
    },
  });
  const primeVideo = context.WatchDashPlatforms.find(
    (platform) => platform.id === "prime-video",
  );

  // hosts and paths are lowercased before matching
  assert.strictEqual(
    primeVideo.detect({ host: "www.amazon.com", path: "/GP/VIDEO/" }),
    true,
  );
  assert.strictEqual(
    primeVideo.detect({ host: "Amazon.com", path: "/gp/video/" }),
    true,
  );
  assert.strictEqual(
    primeVideo.detect({ host: "smile.amazon.de", path: "/AmazonVideo/" }),
    false,
  );
  // the amazon.* prefix rule is not suffix-anchored today
  assert.strictEqual(
    primeVideo.detect({ host: "amazon.com.evil.test", path: "/gp/video/" }),
    true,
  );
  assert.strictEqual(primeVideo.detect({ host: "", path: "/" }), false);
}

function testPlatformRegistryIntegrity() {
  const context = loadScripts(
    ["src/shared/defaults.js", "src/content/platforms.js"],
    {
      document: {
        title: "",
        querySelector() {
          return null;
        },
      },
      location: {
        hostname: "www.youtube.com",
        pathname: "/watch",
      },
    },
  );
  // copy out of the vm realm so deepStrictEqual sees host prototypes
  const platforms = Array.from(context.WatchDashPlatforms);
  const defaults = context.WatchDashDefaults.defaultSettings;
  const ids = platforms.map((platform) => platform.id);

  assert.strictEqual(
    new Set(ids).size,
    ids.length,
    `platform ids must be unique, got ${ids.join(", ")}.`,
  );

  for (const platform of platforms) {
    assert.strictEqual(
      typeof platform.label,
      "string",
      `${platform.id} needs a label.`,
    );
    assert.ok(platform.label.length > 0, `${platform.id} label is empty.`);
    assert.ok(Array.isArray(platform.actions));
    assert.ok(platform.actions.length > 0, `${platform.id} has no actions.`);

    for (const pattern of platform.hostPatterns || []) {
      assert.match(
        pattern,
        /^[a-z0-9.-]+$/,
        `${platform.id} host pattern "${pattern}" must be a bare lowercase domain.`,
      );
      assert.strictEqual(
        pattern.endsWith("."),
        false,
        `${platform.id} host pattern "${pattern}" has a trailing dot.`,
      );
    }

    for (const pattern of platform.watchUrlPatterns || []) {
      assert.strictEqual(
        typeof pattern,
        "string",
        `${platform.id} watchUrlPatterns must hold strings.`,
      );
      assert.ok(
        pattern.startsWith("/"),
        `${platform.id} watchUrlPattern "${pattern}" must start with a slash.`,
      );
    }

    for (const action of platform.actions) {
      assert.ok(action.id, `${platform.id} action missing an id.`);
      assert.ok(
        Object.prototype.hasOwnProperty.call(defaults, action.setting),
        `${platform.id}/${action.id} gates on unknown setting "${action.setting}".`,
      );
      assert.strictEqual(typeof action.cooldownMs, "number");
      assert.ok(
        action.cooldownMs >= 0,
        `${platform.id}/${action.id} has negative cooldown ${action.cooldownMs}.`,
      );
      for (const selector of action.selectors) {
        assert.strictEqual(typeof selector, "string");
      }
      for (const text of action.text) {
        assert.strictEqual(typeof text, "string");
      }

      // only netflix and youtube tune end-of-video thresholds today
      if (
        action.type === "nextEpisode" &&
        action.minProgressBeforeEnded !== undefined
      ) {
        assert.ok(
          action.minProgressBeforeEnded > 0 &&
            action.minProgressBeforeEnded <= 1,
          `${platform.id}/${action.id} minProgressBeforeEnded out of range.`,
        );
        assert.ok(
          action.maxRemainingSecondsBeforeEnded > 0,
          `${platform.id}/${action.id} maxRemainingSecondsBeforeEnded must be positive.`,
        );
      }
    }
  }

  const fallbackIds = platforms
    .filter((platform) => platform.allowVideoSurfaceFallback)
    .map((platform) => platform.id);
  assert.deepStrictEqual(fallbackIds, ["jellyfin"]);

  const featured = platforms.filter((platform) => platform.features);
  assert.deepStrictEqual(
    featured.map((platform) => platform.id),
    ["youtube"],
  );
  assert.deepStrictEqual(
    { ...featured[0].features },
    {
      youtubeQualityControls: true,
      youtubeAdControls: true,
    },
  );
}

function testPlatformExtensionPrependsSpecificSelectors() {
  const context = loadScripts(["src/content/platforms.js"], {
    document: {
      querySelector() {
        return null;
      },
    },
    location: {
      hostname: "www.netflix.com",
      pathname: "/watch/123",
    },
  });
  const netflix = context.WatchDashPlatforms.find(
    (platform) => platform.id === "netflix",
  );
  const skipIntro = netflix.actions.find(
    (action) => action.id === "skip-intro",
  );
  const nextEpisode = netflix.actions.find(
    (action) => action.id === "next-episode",
  );

  assert.strictEqual(
    skipIntro.selectors[0],
    "button[data-uia='player-skip-intro']",
    "netflix-specific selectors must come before the shared ones.",
  );
  assert.ok(
    skipIntro.selectors.includes("button[aria-label*='Skip Intro' i]"),
    "extended actions keep the common selectors.",
  );
  assert.strictEqual(nextEpisode.cooldownMs, 90000);
  assert.strictEqual(nextEpisode.minProgressBeforeEnded, 0.95);
  assert.strictEqual(nextEpisode.maxRemainingSecondsBeforeEnded, 180);

  const hboMax = context.WatchDashPlatforms.find(
    (platform) => platform.id === "hbo-max",
  );
  for (const action of hboMax.actions) {
    assert.ok(
      action.selectors.includes(`button[data-testid*='${action.id}' i]`),
      `hbo-max ${action.id} should gain a generated data-testid selector.`,
    );
  }
}

function makeVisibilityElement(overrides) {
  return Object.assign(
    {
      checkVisibility: () => true,
      getAttribute() {
        return null;
      },
      getBoundingClientRect() {
        return {
          left: 10,
          top: 10,
          right: 110,
          bottom: 60,
          width: 100,
          height: 50,
        };
      },
    },
    overrides,
  );
}

function loadAutomationForVisibility(windowOverrides, styleStub) {
  return loadScripts(["src/content/automation.js"], {
    window: Object.assign(
      {
        innerWidth: 1280,
        innerHeight: 720,
        addEventListener() {},
        setTimeout(callback) {
          callback();
          return 1;
        },
        clearTimeout() {},
      },
      windowOverrides,
    ),
    getComputedStyle:
      styleStub ||
      (() => ({ visibility: "visible", display: "block", opacity: "1" })),
    Event: class {},
  });
}

function testVisibilityHeuristicsMatrix() {
  const automation = loadAutomationForVisibility().WatchDashAutomation;

  assert.strictEqual(
    automation.isVisibleElement(makeVisibilityElement()),
    true,
  );

  assert.strictEqual(
    automation.isVisibleElement(
      makeVisibilityElement({
        getBoundingClientRect() {
          return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
        },
      }),
    ),
    false,
    "zero-sized elements are invisible.",
  );

  const offscreenCases = [
    [
      { left: 1300, top: 10, right: 1400, bottom: 60, width: 100, height: 50 },
      "past the right edge",
    ],
    [
      { left: -200, top: 10, right: -100, bottom: 60, width: 100, height: 50 },
      "past the left edge",
    ],
    [
      { left: 10, top: -100, right: 110, bottom: -50, width: 100, height: 50 },
      "above the viewport",
    ],
    [
      { left: 10, top: 730, right: 110, bottom: 780, width: 100, height: 50 },
      "below the viewport",
    ],
  ];
  for (const [rect, why] of offscreenCases) {
    assert.strictEqual(
      automation.isVisibleElement(
        makeVisibilityElement({ getBoundingClientRect: () => rect }),
      ),
      false,
      `elements fully ${why} must be invisible.`,
    );
  }

  const styleCases = [
    { visibility: "visible", display: "none", opacity: "1" },
    { visibility: "hidden", display: "block", opacity: "1" },
    { visibility: "visible", display: "block", opacity: "0" },
    { visibility: "visible", display: "block", opacity: "0.01" },
  ];
  for (const style of styleCases) {
    const styled = loadAutomationForVisibility({}, () => style);
    assert.strictEqual(
      styled.WatchDashAutomation.isVisibleElement(makeVisibilityElement()),
      false,
      `style ${JSON.stringify(style)} must be treated as invisible.`,
    );
  }

  // opacity just above the cutoff stays clickable
  assert.strictEqual(
    loadAutomationForVisibility({}, () => ({
      visibility: "visible",
      display: "block",
      opacity: "0.02",
    })).WatchDashAutomation.isVisibleElement(makeVisibilityElement()),
    true,
  );

  assert.strictEqual(
    automation.isVisibleElement(
      makeVisibilityElement({ checkVisibility: () => false }),
    ),
    false,
    "checkVisibility() false wins over other signals.",
  );
  assert.strictEqual(
    automation.isVisibleElement(
      makeVisibilityElement({
        checkVisibility() {
          throw new Error("patched");
        },
      }),
    ),
    true,
    "a throwing checkVisibility falls through to explicit checks.",
  );
  assert.strictEqual(
    automation.isVisibleElement(
      makeVisibilityElement({
        getBoundingClientRect() {
          throw new Error("patched DOM failure");
        },
      }),
    ),
    false,
  );
  assert.strictEqual(
    loadAutomationForVisibility({}, () => {
      throw new Error("patched computed style");
    }).WatchDashAutomation.isVisibleElement(makeVisibilityElement()),
    false,
  );
}

function testVisibilityOverlayHitTesting() {
  const covered = makeVisibilityElement({
    ownerDocument: {
      elementFromPoint() {
        return { someOtherNode: true };
      },
    },
  });
  const hitIsSelf = makeVisibilityElement({
    ownerDocument: {
      elementFromPoint() {
        return hitIsSelf;
      },
    },
  });
  const childContainsRoot = makeVisibilityElement({
    contains() {
      return true;
    },
    ownerDocument: {
      elementFromPoint() {
        return { childOfTarget: true };
      },
    },
  });
  const shadowHost = {};
  const shadowHostRetarget = makeVisibilityElement({
    getRootNode() {
      return { host: shadowHost };
    },
    ownerDocument: {
      elementFromPoint() {
        return shadowHost;
      },
    },
  });
  const elementFromPointThrows = makeVisibilityElement({
    ownerDocument: {
      elementFromPoint() {
        throw new Error("patched hit testing");
      },
    },
  });
  const automation = loadAutomationForVisibility().WatchDashAutomation;

  assert.strictEqual(
    automation.isVisibleElement(covered),
    false,
    "an unrelated overlay at the center point hides the control.",
  );
  assert.strictEqual(automation.isVisibleElement(hitIsSelf), true);
  assert.strictEqual(automation.isVisibleElement(childContainsRoot), true);
  assert.strictEqual(
    automation.isVisibleElement(shadowHostRetarget),
    true,
    "shadow-tree retargeting to the host keeps the control visible.",
  );
  assert.strictEqual(automation.isVisibleElement(elementFromPointThrows), true);
}

function testVisibilityWithoutViewportMetricsAssumesVisible() {
  const context = loadScripts(["src/content/automation.js"], {
    getComputedStyle() {
      return { visibility: "visible", display: "block", opacity: "1" };
    },
  });
  const automation = context.WatchDashAutomation;

  assert.strictEqual(
    automation.isVisibleElement(
      makeVisibilityElement({
        getBoundingClientRect() {
          return {
            left: 5000,
            top: 5000,
            right: 5200,
            bottom: 5060,
            width: 200,
            height: 60,
          };
        },
      }),
    ),
    true,
    "without window metrics the viewport gate cannot reject anything.",
  );
}

function testAutomationTextHelpersAndQueryGuards() {
  const context = loadScripts(["src/content/automation.js"], {
    document: {
      querySelectorAll() {
        return [];
      },
    },
  });
  const automation = context.WatchDashAutomation;

  assert.strictEqual(
    automation.normalizeText("  Skip \n\t INTRO  "),
    "skip intro",
  );
  assert.strictEqual(automation.normalizeText(null), "");
  assert.strictEqual(automation.normalizeText(undefined), "");

  // results come from the vm realm, so copy before deep comparison
  assert.deepStrictEqual(
    Array.from(automation.queryElements("#movie_player", null)),
    [],
  );
  assert.deepStrictEqual(
    Array.from(automation.queryElements("button", {})),
    [],
    "roots without querySelectorAll yield no matches.",
  );

  const throwingRoot = {
    querySelectorAll() {
      throw new Error("bad selector");
    },
  };
  assert.deepStrictEqual(
    Array.from(automation.queryElements("button[broken", throwingRoot)),
    [],
    "invalid selectors or patched roots must not throw.",
  );
}

function testAutomationSkipsDisabledAndAriaDisabledCandidates() {
  function makeButton(label, overrides) {
    return Object.assign(
      {
        disabled: false,
        value: "",
        textContent: label,
        checkVisibility: () => true,
        closest: () => null,
        getAttribute(name) {
          return name === "aria-label" ? label : null;
        },
        getBoundingClientRect() {
          return { width: 80, height: 24 };
        },
        querySelectorAll() {
          return [];
        },
      },
      overrides,
    );
  }

  const disabledButton = makeButton("Skip Intro", { disabled: true });
  const ariaDisabledButton = makeButton("Skip Intro", {
    getAttribute(name) {
      return name === "aria-disabled" ? "true" : null;
    },
  });
  const liveButton = makeButton("Skip Intro");
  const context = loadScripts(["src/content/automation.js"], {
    document: {
      querySelectorAll(selector) {
        return selector ===
          "button, a, [role='button'], input[type='button'], input[type='submit']"
          ? [disabledButton, ariaDisabledButton, liveButton]
          : [];
      },
    },
    getComputedStyle() {
      return { visibility: "visible", display: "block", opacity: "1" };
    },
  });
  const automation = context.WatchDashAutomation;
  const action = { selectors: [], text: ["Skip Intro"] };

  assert.strictEqual(
    automation.findActionTarget(action, { allowTextFallback: true }),
    liveButton,
    "text fallback must skip disabled and aria-disabled controls.",
  );
}

testSettingsStorageEnvelope();
testAutomationTextFallbackGate();
testAutomationTextFallbackCanBeScopedToPlayerRoot();
testAutomationSkipsElementsWithPatchedVisibilityApis();
testAutomationSelectorRootsAndQueryCacheAvoidRepeatedScans();
testPlatformActionsDedupeSelectorsAtRegistration();
testContentInitializationPreservesVideoPreload();
testContentSchedulerCoalescesMutationsAndScopesObserver();
testOptionalSiteDetectionOnlyOnUnregisteredHosts();
testPopupUnknownFrameCountsStayUnavailable();
testPopupIgnoresOutOfOrderSettingsResponses();
testYouTubeBridgeRegistrationHandshakeAndOriginGuard();
testYouTubeSelectorsFromPlayerProbe();
testPrimeVideoDetectorAvoidsGeneralAmazonPages();
testYouTubeAdOverlayDetectionAndJumpFallback();
testYouTubeBridgeQueueWaitsForHandshakeAndFailsClosed();
testActiveVideoSelectionUsesScorePriority();
testActiveVideoSelectionPreservesFirstTie();

testDefaultsContract();
testNormalizeWithoutInputReturnsAllDefaults();
testSpeedClampBoundaries();
testNonNumericSpeedsFallBackToDefaults();
testInvertedSpeedBoundsResetBeforeTargetClamp();
testDependentClampsFollowEffectiveBounds();
testCoerceBooleanTextTable();
testQualityTargetSnappingAndFormatting();
testParseImportedSettingsEnvelopeAndErrors();
testExportRoundTripStripsUnknownKeys();
testSettingsPayloadAndMigrationGuards();
testJellyfinDetectorSignalGating();
testPrimeVideoDetectorHostNormalization();
testPlatformRegistryIntegrity();
testPlatformExtensionPrependsSpecificSelectors();
testVisibilityHeuristicsMatrix();
testVisibilityOverlayHitTesting();
testVisibilityWithoutViewportMetricsAssumesVisible();
testAutomationTextHelpersAndQueryGuards();
testAutomationSkipsDisabledAndAriaDisabledCandidates();

testValidatorLoopbackExemptionCoversIpv6LoopbackOnly();
testPopupStatusLiveRegionStructure();

console.log("Unit tests OK");
