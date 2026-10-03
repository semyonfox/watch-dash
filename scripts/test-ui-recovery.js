const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const surface of ["popup", "options"]) {
  const elements = new Map();
  const timers = new Map();
  const writes = [];
  const errors = [];
  let ready;
  let read;
  let timerId = 0;
  let failSave = false;
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        id,
        dataset: {},
        value: "",
        disabled: false,
        style: { setProperty() {} },
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener(name, listener) {
          listeners.set(name, listener);
        },
        fire(name) {
          listeners.get(name)();
        },
        setAttribute() {},
        appendChild() {},
        querySelector() {
          return null;
        },
        focus() {
          document.activeElement = this;
        },
      });
    }
    return elements.get(id);
  }
  const speedId = surface === "popup" ? "speedNumber" : "targetSpeed";
  const controls = [
    element(speedId),
    element("importButton"),
    element("resetDefaultsButton"),
  ];
  const document = {
    body: { dataset: {} },
    activeElement: null,
    addEventListener(name, listener) {
      if (name === "DOMContentLoaded") ready = listener;
    },
    getElementById: element,
    querySelectorAll(selector) {
      return selector.startsWith("input:not") ? controls : [];
    },
    createDocumentFragment() {
      return { appendChild() {} };
    },
  };
  const chrome = {
    runtime: { lastError: null },
    storage: {
      sync: {
        get(keys, callback) {
          read = callback;
        },
        set(value, callback) {
          writes.push(value);
          chrome.runtime.lastError = failSave
            ? { message: "private synthetic message" }
            : null;
          callback();
          chrome.runtime.lastError = null;
        },
      },
    },
    tabs: {
      query(query, callback) {
        callback([{ id: 1 }]);
      },
      sendMessage(id, message, callback) {
        callback(undefined);
      },
    },
  };
  const context = vm.createContext({
    document,
    chrome,
    console,
    setInterval() {},
    addEventListener() {},
    setTimeout(callback) {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    WatchDashTelemetry: {
      configured: false,
      onPreference() {},
      error(category, route) {
        errors.push({ category, route });
      },
    },
  });
  for (const file of [
    "src/shared/defaults.js",
    "src/shared/settings.js",
    `src/${surface}/${surface}.js`,
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
      context,
      { filename: file },
    );
  }
  ready();
  assert(
    controls.every((control) => control.disabled),
    `${surface}: initial controls must wait for storage`,
  );
  element(speedId).value = "1.55";
  element(speedId).fire("change");
  assert.strictEqual(writes.length, 0, `${surface}: no writes before read`);
  chrome.runtime.lastError = { message: "private synthetic load failure" };
  read({});
  chrome.runtime.lastError = null;
  assert(element("settingsStatus").textContent.includes("Could not load"));
  assert.strictEqual(element("retrySettings").hidden, false);
  assert(controls.every((control) => control.disabled));
  assert.deepStrictEqual(errors, [
    {
      category: "storage_failed",
      route: surface === "popup" ? "popup" : "settings",
    },
  ]);

  element("retrySettings").focus();
  element("retrySettings").fire("click");
  assert.strictEqual(
    document.activeElement,
    element("settingsStatus"),
    `${surface}: focus remains visible after hiding Retry`,
  );
  read({
    watchDashSettings: context.WatchDashSettings.toStorageValue({
      targetSpeed: 1.75,
      maxSpeed: 3,
    }),
  });
  assert(controls.every((control) => !control.disabled));
  assert.strictEqual(Number(element(speedId).value), 1.75);
  assert.strictEqual(writes.length, 0);

  failSave = true;
  element(speedId).value = "1.55";
  element(speedId).fire("change");
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(
    timers.size,
    0,
    `${surface}: immediate flush clears debounce timer`,
  );
  for (const callback of timers.values()) callback();
  assert.strictEqual(
    writes.length,
    1,
    `${surface}: failed save waits for manual Retry`,
  );
  assert(element("settingsStatus").textContent.includes("not saved"));
  assert.strictEqual(Number(element(speedId).value), 1.55);
  failSave = false;
  element("retrySettings").focus();
  element("retrySettings").fire("click");
  assert.strictEqual(writes.length, 2);
  assert.strictEqual(document.activeElement, element("settingsStatus"));
  assert.strictEqual(
    element("settingsStatus").textContent,
    "Preferences saved.",
  );
}

console.log("UI storage recovery OK");
