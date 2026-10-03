const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(overrides = {}) {
  let now = 100000;
  let preference = true;
  let changed;
  const requests = [];
  const writes = [];
  const timers = new Map();
  let timerId = 0;
  const context = {
    URL,
    AbortController,
    Promise,
    Date: { now: () => now },
    navigator: {},
    WatchDashTelemetryConfig: {
      enabled: true,
      endpoint: "https://collector.example/v1/events",
    },
    chrome: {
      runtime: { lastError: null },
      permissions: { contains: (query, callback) => callback(true) },
      storage: {
        local: {
          get: (keys, callback) =>
            callback({ watchDashTelemetryEnabled: preference }),
          set: (value, callback) => {
            writes.push(value);
            preference = value.watchDashTelemetryEnabled;
            callback();
          },
        },
        onChanged: {
          addListener: (listener) => {
            changed = listener;
          },
        },
      },
    },
    setTimeout: (callback) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: (url, options) => {
      requests.push({ url, options });
      return Promise.resolve({ status: 204 });
    },
    ...overrides,
  };
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../src/shared/telemetry.js"), "utf8"),
    context,
  );
  return {
    context,
    client: context.WatchDashTelemetry,
    requests,
    writes,
    timers,
    advance: (ms) => {
      now += ms;
    },
    changed: (...args) => changed(...args),
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function testTelemetry() {
  for (const config of [
    {},
    { enabled: false, endpoint: "https://collector.example/v1/events" },
    { enabled: true, endpoint: "http://collector.example/v1/events" },
    {
      enabled: true,
      endpoint: "https://collector.example/v1/events?secret=private",
    },
  ]) {
    const f = fixture({ WatchDashTelemetryConfig: config });
    f.client.count("screen_view", "popup");
    assert.equal(f.requests.length, 0);
  }
  for (const navigator of [
    { globalPrivacyControl: true },
    { doNotTrack: "1" },
  ]) {
    const f = fixture({ navigator });
    f.client.error("storage_failed", "settings");
    assert.equal(f.requests.length, 0);
  }
  const f = fixture();
  f.client.count("screen_view", "popup", {
    text: "private fixture text",
    id: "private-id",
  });
  await settle();
  const { options } = f.requests[0];
  assert.deepEqual(JSON.parse(options.body), {
    version: 1,
    app: "watch-dash",
    kind: "count",
    name: "screen_view",
    surface: "extension",
    route: "popup",
  });
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.redirect, "error");
  f.client.error(
    new Error("private text https://private.example/account/123"),
    "settings",
  );
  f.client.count("screen_view", "/settings?account=private");
  assert.equal(f.requests.length, 1);
  await f.client.setEnabled(false);
  f.client.count("screen_view", "popup");
  assert.equal(f.requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes)), [
    { watchDashTelemetryEnabled: false },
  ]);
  await f.client.setEnabled(true);
  f.changed({ watchDashTelemetryEnabled: { newValue: false } }, "local");
  f.client.count("screen_view", "popup");
  assert.equal(f.requests.length, 1);

  const bounded = fixture();
  for (let minute = 0; minute < 12; minute += 1) {
    for (let i = 0; i < 25; i += 1) {
      bounded.client.count("screen_view", "settings");
      await settle();
    }
    assert.equal(bounded.requests.length, Math.min((minute + 1) * 20, 200));
    bounded.advance(60000);
  }
  const repeated = fixture();
  repeated.client.error("storage_failed", "settings");
  await settle();
  repeated.client.error("storage_failed", "settings");
  assert.equal(repeated.requests.length, 1);
  repeated.advance(60000);
  repeated.client.error("storage_failed", "settings");
  await settle();
  assert.equal(repeated.requests.length, 2);

  const failure = fixture({
    fetch: () => Promise.reject(new Error("private transport failure")),
  });
  failure.client.count("screen_view", "popup");
  await settle();
  assert.equal(failure.timers.size, 0);
  failure.client.error("storage_failed", "settings");
  await settle();
  assert.equal(failure.timers.size, 0);
  const hung = fixture({ fetch: () => new Promise(() => {}) });
  hung.client.count("screen_view", "popup");
  hung.client.count("screen_view", "popup");
  assert.equal(hung.timers.size, 1);
  [...hung.timers.values()][0]();
  assert.equal(hung.timers.size, 0);

  const pending = [];
  const late = fixture({
    fetch: () => new Promise((resolve) => pending.push(resolve)),
  });
  late.client.count("screen_view", "popup");
  [...late.timers.values()][0]();
  late.client.count("screen_view", "settings");
  assert.equal(pending.length, 2);
  pending[0]({ status: 204 });
  await settle();
  late.client.count("screen_view", "popup");
  assert.equal(
    pending.length,
    2,
    "late completion cannot release a newer request",
  );
  pending[1]({ status: 204 });
  await settle();
  assert.equal(late.timers.size, 0);
  console.log("Telemetry privacy and bounds OK");
}

testTelemetry().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
