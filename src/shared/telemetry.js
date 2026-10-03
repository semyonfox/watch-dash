(function registerTelemetry(root) {
  const config = root.WatchDashTelemetryConfig || {};
  const api = root.chrome;
  const counts = new Set([
    "app_open",
    "screen_view",
    "action_completed",
    "action_failed",
  ]);
  const errors = new Set([
    "unexpected_error",
    "request_failed",
    "render_failed",
    "storage_failed",
    "permission_failed",
    "media_failed",
    "validation_failed",
  ]);
  const routes = new Set(["popup", "settings"]);
  const listeners = [];
  const lastErrors = new Map();
  let endpoint = null;
  let enabled = false;
  let preferenceRevision = 0;
  let inFlight = false;
  let lifetime = 0;
  let minuteStart = 0;
  let minuteCount = 0;

  try {
    const url = new URL(config.endpoint);
    if (
      config.enabled === true &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/v1/events"
    )
      endpoint = url;
  } catch {
    // an absent endpoint keeps collection off
  }

  function optedOut() {
    const nav = root.navigator || {};
    return (
      nav.globalPrivacyControl === true ||
      nav.doNotTrack === "1" ||
      root.doNotTrack === "1"
    );
  }

  function notifyPreference() {
    for (const listener of listeners) listener(enabled);
  }

  if (api && api.storage && api.storage.local) {
    api.storage.local.get(["watchDashTelemetryEnabled"], (value) => {
      if (preferenceRevision !== 0) return;
      enabled =
        !api.runtime.lastError && value.watchDashTelemetryEnabled === true;
      notifyPreference();
    });
  }

  if (api && api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.watchDashTelemetryEnabled) return;
      preferenceRevision += 1;
      enabled = changes.watchDashTelemetryEnabled.newValue === true;
      notifyPreference();
    });
  }

  function setEnabled(value) {
    const revision = ++preferenceRevision;
    enabled = false;
    notifyPreference();
    return new Promise((resolve) => {
      if (!api || !api.storage || !api.storage.local) {
        resolve(false);
        return;
      }
      api.storage.local.set(
        { watchDashTelemetryEnabled: value === true },
        () => {
          if (revision !== preferenceRevision) {
            resolve(!api.runtime.lastError);
            return;
          }
          enabled = !api.runtime.lastError && value === true;
          notifyPreference();
          resolve(!api.runtime.lastError);
        },
      );
    });
  }

  function send(kind, name, route) {
    if (
      !endpoint ||
      !enabled ||
      optedOut() ||
      inFlight ||
      lifetime >= 200 ||
      !routes.has(route) ||
      !(kind === "count" ? counts : errors).has(name)
    )
      return;
    if (
      !api ||
      !api.permissions ||
      typeof api.permissions.contains !== "function" ||
      typeof root.fetch !== "function" ||
      typeof root.AbortController !== "function"
    )
      return;
    const now = Date.now();
    if (now - minuteStart >= 60000) {
      minuteStart = now;
      minuteCount = 0;
    }
    if (minuteCount >= 20) return;
    const errorKey = name + ":" + route;
    if (
      kind === "error" &&
      lastErrors.has(errorKey) &&
      now - lastErrors.get(errorKey) < 60000
    )
      return;
    if (kind === "error") lastErrors.set(errorKey, now);
    minuteCount += 1;
    lifetime += 1;
    inFlight = true;
    const controller = new root.AbortController();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      inFlight = false;
      root.clearTimeout(timeout);
    };
    const timeout = root.setTimeout(() => {
      controller.abort();
      finish();
    }, 2000);
    try {
      api.permissions.contains(
        { origins: [endpoint.origin + "/*"] },
        (allowed) => {
          if (finished) return;
          if (api.runtime.lastError || !allowed || !enabled || optedOut()) {
            finish();
            return;
          }
          const body = JSON.stringify({
            version: 1,
            app: "watch-dash",
            kind,
            name,
            surface: "extension",
            route,
          });
          Promise.resolve(
            root.fetch(endpoint.href, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
              credentials: "omit",
              referrerPolicy: "no-referrer",
              redirect: "error",
              signal: controller.signal,
            }),
          )
            .catch(() => {})
            .finally(finish);
        },
      );
    } catch {
      finish();
    }
  }

  root.WatchDashTelemetry = Object.freeze({
    configured: Boolean(endpoint),
    setEnabled,
    onPreference(listener) {
      listeners.push(listener);
      listener(enabled);
    },
    count(name, route) {
      send("count", name, route);
    },
    error(name, route) {
      send("error", name, route);
    },
  });
})(globalThis);
