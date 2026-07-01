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

function testQualityDiagnosticsDoNotMutatePreload() {
  const video = {
    playbackRate: 1,
    paused: false,
    ended: false,
    preload: "metadata",
    duration: 600,
    currentTime: 10,
    getBoundingClientRect() {
      return { width: 1280, height: 720 };
    }
  };
  let observed = false;

  loadScripts([
    "src/shared/defaults.js",
    "src/shared/settings.js",
    "src/content/watch-dash.js"
  ], {
    location: {
      hostname: "example.test",
      pathname: "/watch",
      href: "https://example.test/watch"
    },
    chrome: {
      runtime: {
        lastError: null,
        onMessage: {
          addListener() {}
        }
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
                  youtubeQualityControls: false
                }
              }
            });
          },
          set() {}
        },
        onChanged: {
          addListener() {}
        }
      }
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
        appendChild() {}
      },
      createElement(tagName) {
        return { tagName, className: "", textContent: "", remove() {} };
      }
    },
    window: {
      addEventListener() {},
      setTimeout() {
        return 1;
      },
      clearTimeout() {},
      setInterval() {}
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
      }
    },
    WatchDashAutomation: {
      findActionTarget() {
        return null;
      },
      clickTarget() {}
    },
    WatchDashPlatforms: [
      {
        id: "test",
        hostPatterns: ["example.test"],
        actions: []
      }
    ]
  });

  assert.strictEqual(observed, true);
  assert.strictEqual(video.preload, "metadata");
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

function makeVideo({ paused, ended, width, height }) {
  return {
    paused,
    ended,
    getBoundingClientRect() {
      return { width, height };
    }
  };
}

function testActiveVideoSelectionUsesScorePriority() {
  const endedSmall = makeVideo({ paused: false, ended: true, width: 320, height: 180 });
  const pausedLarge = makeVideo({ paused: true, ended: false, width: 1600, height: 900 });
  const playingSmall = makeVideo({ paused: false, ended: false, width: 320, height: 180 });
  const playingLarge = makeVideo({ paused: false, ended: false, width: 1280, height: 720 });
  const videos = [endedSmall, pausedLarge, playingSmall, playingLarge];
  const context = loadScripts(["src/content/media.js"], {
    document: {
      querySelectorAll(selector) {
        return selector === "video" ? videos : [];
      }
    }
  });

  assert.strictEqual(context.WatchDashMedia.findActiveVideo(), playingLarge);
}

function testActiveVideoSelectionPreservesFirstTie() {
  const first = makeVideo({ paused: false, ended: false, width: 640, height: 360 });
  const second = makeVideo({ paused: false, ended: false, width: 640, height: 360 });
  const context = loadScripts(["src/content/media.js"], {
    document: {
      querySelectorAll(selector) {
        return selector === "video" ? [first, second] : [];
      }
    }
  });

  assert.strictEqual(context.WatchDashMedia.findActiveVideo(), first);
}

testSettingsStorageEnvelope();
testAutomationTextFallbackGate();
testQualityDiagnosticsDoNotMutatePreload();
testYouTubeBridgeOriginAndQuality();
testYouTubeSelectorsFromPlayerProbe();
testYouTubeAdOverlayDetectionAndJumpFallback();
testYouTubeBridgeQueueClearsOnInjectionFailure();
testActiveVideoSelectionUsesScorePriority();
testActiveVideoSelectionPreservesFirstTie();

console.log("Unit tests OK");
