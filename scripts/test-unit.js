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

testSettingsStorageEnvelope();
testAutomationTextFallbackGate();
testYouTubeBridgeOriginAndQuality();

console.log("Unit tests OK");
