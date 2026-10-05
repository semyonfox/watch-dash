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
  // preserve throwing host getters across the VM boundary
  context.globalThis = new Proxy(context, { get: Reflect.get });
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
  await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(JSON.parse(f.requests[1].options.body).route, "app");
  assert(!f.requests[1].options.body.includes("private"));
  await f.client.setEnabled(false);
  f.client.count("screen_view", "popup");
  assert.equal(f.requests.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes)), [
    { watchDashTelemetryEnabled: false },
  ]);
  await f.client.setEnabled(true);
  f.changed({ watchDashTelemetryEnabled: { newValue: false } }, "local");
  f.client.count("screen_view", "popup");
  assert.equal(f.requests.length, 2);

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

  for (const kind of ["count", "error"]) {
    const record = (f, route = "popup") =>
      f.client[kind](
        kind === "count" ? "screen_view" : "storage_failed",
        route,
      );

    for (const disabledBy of ["configuration", "preference"]) {
      const disabled = fixture(
        disabledBy === "configuration" ? { WatchDashTelemetryConfig: {} } : {},
      );
      if (disabledBy === "preference") await disabled.client.setEnabled(false);
      let reads = 0;
      Object.defineProperty(disabled.context.navigator, "doNotTrack", {
        get() {
          reads += 1;
          throw new Error("private privacy failure");
        },
      });
      assert.doesNotThrow(() => record(disabled));
      assert.equal(
        reads,
        0,
        "default-off and opt-out short-circuit privacy reads",
      );
      assert.equal(disabled.requests.length, 0);
    }

    for (const signal of [
      "globalPrivacyControl",
      "doNotTrack",
      "rootDoNotTrack",
      "navigator",
    ]) {
      const privacy = fixture();
      const target = ["rootDoNotTrack", "navigator"].includes(signal)
        ? privacy.context
        : privacy.context.navigator;
      const property = signal === "rootDoNotTrack" ? "doNotTrack" : signal;
      const original = Object.getOwnPropertyDescriptor(target, property);
      Object.defineProperty(target, property, {
        configurable: true,
        get() {
          throw new Error("private privacy failure");
        },
      });
      assert.doesNotThrow(() => record(privacy));
      assert.equal(
        privacy.requests.length,
        0,
        `${kind}/${signal}: privacy gate`,
      );
      assert.equal(privacy.timers.size, 0);
      if (original) Object.defineProperty(target, property, original);
      else delete target[property];
      record(privacy);
      await settle();
      assert.equal(privacy.requests.length, 1, `${kind}/${signal}: recovery`);
    }

    for (const property of ["AbortController", "setTimeout"]) {
      const setup = fixture();
      const original = setup.context[property];
      setup.context[property] = function () {
        throw new Error("private setup failure");
      };
      assert.doesNotThrow(() => record(setup));
      assert.equal(
        setup.requests.length,
        0,
        `${kind}/${property}: no dispatch without timeout`,
      );
      assert.equal(setup.timers.size, 0);
      setup.context[property] = original;
      setup.advance(60000);
      record(setup);
      await settle();
      assert.equal(
        setup.requests.length,
        1,
        `${kind}/${property}: slot recovered`,
      );
    }

    for (const failure of ["privacy", "fetch"]) {
      const delayed = fixture();
      const callbacks = [];
      delayed.context.chrome.permissions.contains = (query, callback) =>
        callbacks.push(callback);
      const originalFetch = delayed.context.fetch;
      record(delayed);
      if (failure === "privacy") {
        Object.defineProperty(delayed.context.navigator, "doNotTrack", {
          configurable: true,
          get() {
            throw new Error("private delayed privacy failure");
          },
        });
      } else {
        delayed.context.fetch = () => {
          throw new Error("private synchronous fetch failure");
        };
      }
      assert.doesNotThrow(
        () => callbacks[0](true),
        `${kind}/${failure}: delayed callback contained`,
      );
      assert.equal(delayed.requests.length, 0);
      assert.equal(delayed.timers.size, 0);
      delete delayed.context.navigator.doNotTrack;
      delayed.context.fetch = originalFetch;
      delayed.advance(60000);
      record(delayed);
      callbacks[1](true);
      await settle();
      assert.equal(
        delayed.requests.length,
        1,
        `${kind}/${failure}: slot recovered`,
      );
    }

    const timeout = fixture();
    const callbacks = [];
    timeout.context.chrome.permissions.contains = (query, callback) =>
      callbacks.push(callback);
    record(timeout);
    [...timeout.timers.values()][0]();
    assert.equal(timeout.requests.length, 0);
    timeout.advance(60000);
    record(timeout);
    assert.doesNotThrow(() => callbacks[0](true));
    assert.equal(
      timeout.timers.size,
      1,
      "old callback preserves the new request timer",
    );
    record(timeout);
    assert.equal(
      callbacks.length,
      2,
      "old callback cannot release the newer request",
    );
    callbacks[1](true);
    await settle();
    assert.equal(timeout.requests.length, 1);

    const optedOut = fixture();
    let permission;
    optedOut.context.chrome.permissions.contains = (query, callback) => {
      permission = callback;
    };
    record(optedOut);
    await optedOut.client.setEnabled(false);
    assert.doesNotThrow(() => permission(true));
    assert.equal(optedOut.requests.length, 0);
    assert.equal(optedOut.timers.size, 0);
    await optedOut.client.setEnabled(true);
    assert.doesNotThrow(() => permission(true));
    assert.equal(
      optedOut.requests.length,
      0,
      "opt-in cannot revive a cancelled event",
    );
    optedOut.advance(60000);
    record(optedOut);
    permission(true);
    await settle();
    assert.equal(optedOut.requests.length, 1);

    const changedBeforePermission = fixture();
    let delayedPermission;
    changedBeforePermission.context.chrome.permissions.contains = (
      query,
      callback,
    ) => {
      delayedPermission = callback;
    };
    record(changedBeforePermission);
    await changedBeforePermission.client.setEnabled(false);
    await changedBeforePermission.client.setEnabled(true);
    assert.doesNotThrow(() => delayedPermission(true));
    assert.equal(
      changedBeforePermission.requests.length,
      0,
      "changed preference drops the original event before its first callback",
    );
    assert.equal(changedBeforePermission.timers.size, 0);
    changedBeforePermission.advance(60000);
    record(changedBeforePermission);
    delayedPermission(true);
    await settle();
    assert.equal(changedBeforePermission.requests.length, 1);

    const cleanup = fixture();
    const clearTimeout = cleanup.context.clearTimeout;
    cleanup.context.clearTimeout = () => {
      throw new Error("private cleanup failure");
    };
    record(cleanup);
    await settle();
    cleanup.context.clearTimeout = clearTimeout;
    cleanup.advance(60000);
    record(cleanup);
    await settle();
    assert.equal(
      cleanup.requests.length,
      2,
      "cleanup failure does not strand the request",
    );

    const fallback = fixture();
    for (const route of [
      "unrecognized",
      "https://private.example/account?id=private",
      "private-account-id",
      null,
      {
        toString() {
          throw new Error("route content must not be read");
        },
      },
    ]) {
      assert.doesNotThrow(() => record(fallback, route));
      await settle();
      const body = fallback.requests.at(-1).options.body;
      assert.equal(JSON.parse(body).route, "app");
      assert.equal(Object.keys(JSON.parse(body)).length, 6);
      assert(!body.includes("private"));
      fallback.advance(60000);
    }
  }
  console.log("Telemetry privacy and bounds OK");
}

testTelemetry().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
