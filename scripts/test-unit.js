const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function loadScripts(files, extras) {
  const context = Object.assign({
    console,
    setTimeout,
    clearTimeout
  }, extras || {});

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
    "src/shared/settings.js"
  ]);
  const settingsTools = context.WatchDashSettings;

  const normalized = settingsTools.normalize({
    settings: {
      targetSpeed: 99,
      minSpeed: 0.5,
      maxSpeed: 3,
      youtubeAdSpeed: 2.5,
      unknownKey: true
    }
  });

  assert.strictEqual(normalized.targetSpeed, 3);
  assert.strictEqual(normalized.youtubeAdSpeed, 2.5);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(normalized, "unknownKey"), false);
  assert.strictEqual(settingsTools.needsStorageMigration({ targetSpeed: 1.5 }), true);

  const stored = settingsTools.toStorageValue({ targetSpeed: 1.5 });
  assert.strictEqual(stored.version, context.WatchDashDefaults.version);
  assert.strictEqual(stored.settings.targetSpeed, 1.5);
  assert.strictEqual(settingsTools.needsStorageMigration(stored), false);
  assert.strictEqual(settingsTools.normalize(stored).targetSpeed, 1.5);
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
    }
  };
  const context = loadScripts(["src/content/automation.js"], {
    document: {
      querySelectorAll(selector) {
        return selector === "button, a, [role='button'], input[type='button'], input[type='submit']" ?
          [element] :
          [];
      }
    },
    getComputedStyle() {
      return { visibility: "visible", display: "block", opacity: "1" };
    }
  });
  const automation = context.WatchDashAutomation;
  const action = { selectors: [], text: ["Resume"] };

  assert.strictEqual(automation.findActionTarget(action, { allowTextFallback: false }), null);
  assert.strictEqual(automation.findActionTarget(action, { allowTextFallback: true }), element);
}

function testYouTubeBridgeOriginAndQuality() {
  const listeners = [];
  const responses = [];
  const calls = [];
  const pageWindow = {
    location: {
      origin: "https://www.youtube.com"
    },
    addEventListener(type, callback) {
      if (type === "message") {
        listeners.push(callback);
      }
    },
    postMessage(payload, targetOrigin) {
      responses.push({ payload, targetOrigin });
    }
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
    }
  };
  const context = loadScripts(["src/content/youtube-bridge.js"], {
    document: {
      currentScript: {
        dataset: {
          watchDashToken: "test-token"
        }
      },
      getElementById(id) {
        return id === "movie_player" ? player : null;
      },
      querySelector() {
        return null;
      }
    },
    window: pageWindow
  });

  assert.strictEqual(context.window, pageWindow);
  assert.strictEqual(listeners.length, 1);

  listeners[0]({
    source: pageWindow,
    origin: "https://attacker.example",
    data: {
      source: "watch-dash-content",
      id: "ignored",
      command: "set-quality",
      token: "test-token",
      targetHeight: 720
    }
  });
  assert.strictEqual(responses.length, 0);

  listeners[0]({
    source: pageWindow,
    origin: "https://www.youtube.com",
    data: {
      source: "watch-dash-content",
      id: "quality-1",
      command: "set-quality",
      token: "test-token",
      targetHeight: 720
    }
  });

  assert.deepStrictEqual(calls, [
    ["range", "hd720", "hd720"],
    ["set", "hd720"]
  ]);
  assert.strictEqual(responses.length, 1);
  assert.strictEqual(responses[0].targetOrigin, "https://www.youtube.com");
  assert.strictEqual(responses[0].payload.id, "quality-1");
  assert.strictEqual(responses[0].payload.token, "test-token");
  assert.strictEqual(responses[0].payload.targetLevel, "hd720");
}

function testYouTubeSelectorsFromPlayerProbe() {
  const context = loadScripts(["src/content/platforms.js"], {
    document: {
      querySelector() {
        return null;
      }
    },
    location: {
      hostname: "www.youtube.com",
      pathname: "/watch"
    }
  });
  const youtube = context.WatchDashPlatforms.find((platform) => platform.id === "youtube");
  const skipAd = youtube.actions.find((action) => action.id === "skip-ad");
  const nextVideo = youtube.actions.find((action) => action.id === "next-video");

  assert(skipAd.selectors.includes("#movie_player .video-ads button.ytp-ad-skip-button-modern"));
  assert(skipAd.selectors.includes("#movie_player .ytp-ad-skip-button-container button"));
  assert(nextVideo.selectors.includes("#movie_player a.ytp-autonav-endscreen-upnext-play-button[role='button']"));
  assert(nextVideo.selectors.includes("#movie_player button.ytp-endscreen-next"));
  assert.strictEqual(nextVideo.minProgressBeforeEnded, 0.985);
  assert.strictEqual(nextVideo.maxRemainingSecondsBeforeEnded, 8);
}

function testYouTubeAdOverlayDetectionAndJumpFallback() {
  const visibleElement = {
    checkVisibility: () => true,
    getBoundingClientRect() {
      return { width: 120, height: 32 };
    }
  };
  const dispatchedEvents = [];
  const context = loadScripts(["src/content/youtube-controller.js"], {
    document: {
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        return selector.includes("ytp-ad-player-overlay") ? [visibleElement] : [];
      }
    },
    window: {
      addEventListener() {}
    },
    getComputedStyle() {
      return { visibility: "visible", display: "block", opacity: "1" };
    },
    Event: class {
      constructor(type, init) {
        this.type = type;
        this.bubbles = Boolean(init && init.bubbles);
      }
    }
  });
  const controller = context.WatchDashYouTubeController;
  const platform = { id: "youtube" };
  const video = {
    currentTime: 3,
    duration: 12,
    seekable: {
      length: 1,
      end() {
        return 12;
      }
    },
    dispatchEvent(event) {
      dispatchedEvents.push(event.type);
    }
  };

  assert.strictEqual(controller.isAdShowing(platform), true);
  assert.strictEqual(controller.jumpForwardThroughAd(platform, { youtubeAutoSkipAds: false }, video), null);
  assert.strictEqual(video.currentTime, 3);
  assert.strictEqual(controller.jumpForwardThroughAd(platform, { youtubeAutoSkipAds: true }, video), "Jump ad");
  assert.strictEqual(video.currentTime, 11.75);
  assert.deepStrictEqual(dispatchedEvents, ["seeking", "timeupdate"]);
}

function testYouTubeBridgeQueueClearsOnInjectionFailure() {
  const createdScripts = [];
  const timeouts = [];
  const context = loadScripts(["src/content/youtube-controller.js"], {
    chrome: {
      runtime: {
        getURL(pathname) {
          return `chrome-extension://watch-dash/${pathname}`;
        }
      }
    },
    document: {
      createElement(tagName) {
        assert.strictEqual(tagName, "script");
        const script = {
          dataset: {},
          remove() {
            this.removed = true;
          }
        };
        createdScripts.push(script);
        return script;
      },
      documentElement: {
        appendChild(script) {
          script.appended = true;
        }
      }
    },
    location: {
      href: "https://www.youtube.com/watch?v=test",
      origin: "https://www.youtube.com"
    },
    window: {
      addEventListener() {},
      clearTimeout(id) {
        timeouts[id].cleared = true;
      },
      postMessage() {},
      setTimeout(callback, delay) {
        timeouts.push({ callback, delay, cleared: false });
        return timeouts.length - 1;
      }
    }
  });
  const controller = context.WatchDashYouTubeController;
  const platform = { id: "youtube" };

  controller.applyQualityTarget(platform, { youtubeQualityControls: true, qualityTargetHeight: 720 });

  assert.strictEqual(createdScripts.length, 1);
  assert.strictEqual(createdScripts[0].appended, true);
  assert.strictEqual(timeouts.length, 1);
  assert.strictEqual(controller.getQualityStatus(platform), null);

  createdScripts[0].onerror();

  const status = controller.getQualityStatus(platform);
  assert.strictEqual(createdScripts[0].removed, true);
  assert.strictEqual(timeouts[0].cleared, true);
  assert.strictEqual(status.ok, false);
  assert.strictEqual(status.command, "set-quality");
  assert.strictEqual(status.error, "bridge-load-error");
}

function testPopupStatusLiveRegionStructure() {
  const html = fs.readFileSync(path.join(root, "src/popup/popup.html"), "utf8");
  const statusSection = html.match(/<section\b(?=[^>]*\bclass="[^"]*\bstatus\b[^"]*\bpanel\b[^"]*")[^>]*>/);
  const lastAction = html.match(/<div\b(?=[^>]*\bid="lastAction")[^>]*>/);

  assert(statusSection, "status panel should exist");
  assert(lastAction, "last action row should exist");
  assert(!/\baria-live=/.test(statusSection[0]));
  assert(/\baria-live="polite"/.test(lastAction[0]));
  assert(/\baria-atomic="true"/.test(lastAction[0]));
}

testSettingsStorageEnvelope();
testAutomationTextFallbackGate();
testYouTubeBridgeOriginAndQuality();
testYouTubeSelectorsFromPlayerProbe();
testYouTubeAdOverlayDetectionAndJumpFallback();
testYouTubeBridgeQueueClearsOnInjectionFailure();
testPopupStatusLiveRegionStructure();

console.log("Unit tests OK");
