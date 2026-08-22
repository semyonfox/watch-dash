const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const missing = [];
const errors = [];

if (require.main === module) {
  runValidation();
}

module.exports = { extractManifestHost, normalizeHost };

function runValidation() {
  if (manifest.action && manifest.action.default_popup) {
    assertFile(manifest.action.default_popup, "action.default_popup");
    assertHtmlAssets(manifest.action.default_popup);
  }

  if (manifest.icons) {
    assertIconFiles(manifest.icons, "manifest.icons");
  }

  if (manifest.action && manifest.action.default_icon) {
    assertIconFiles(manifest.action.default_icon, "action.default_icon");
  }

  if (manifest.background && manifest.background.service_worker) {
    assertFile(manifest.background.service_worker, "background.service_worker");
  }

  for (const [bundleIndex, contentScript] of (
    manifest.content_scripts || []
  ).entries()) {
    for (const jsFile of contentScript.js || []) {
      assertFile(jsFile, `content_scripts[${bundleIndex}].js`);
    }

    for (const cssFile of contentScript.css || []) {
      assertFile(cssFile, `content_scripts[${bundleIndex}].css`);
    }
  }

  for (const [groupIndex, resourceGroup] of (
    manifest.web_accessible_resources || []
  ).entries()) {
    for (const resource of resourceGroup.resources || []) {
      assertFile(resource, `web_accessible_resources[${groupIndex}]`);
    }

    for (const match of resourceGroup.matches || []) {
      if (match === "*://*/*") {
        errors.push(
          "web_accessible_resources must not expose assets to every origin.",
        );
      }
    }
  }

  assertNoForbiddenMatchPatterns(
    manifest.host_permissions || [],
    "host_permissions",
  );

  for (const contentScript of manifest.content_scripts || []) {
    assertNoForbiddenMatchPatterns(
      contentScript.matches || [],
      "content_scripts.matches",
    );
  }

  assertManifestHostCoverage();
  assertPrimaryContentScriptBundle();
  assertContentScriptBundles();
  assertMatchPatternSyntax(manifest.host_permissions || [], "host_permissions");

  for (const contentScript of manifest.content_scripts || []) {
    assertMatchPatternSyntax(
      contentScript.matches || [],
      "content_scripts.matches",
    );
  }

  for (const resourceGroup of manifest.web_accessible_resources || []) {
    assertMatchPatternSyntax(
      resourceGroup.matches || [],
      "web_accessible_resources.matches",
    );
  }

  assertHostPermissionParity();
  assertWebAccessibleResourceCoverage();
  assertCommandDescriptions();
  assertSettingsNormalization();
  assertPopupSettingsBindings();
  assertSourceSyntax();

  if (missing.length > 0 || errors.length > 0) {
    console.error("Missing extension files:");
    for (const file of missing) {
      console.error(`- ${file}`);
    }

    for (const error of errors) {
      console.error(`- ${error}`);
    }

    process.exit(1);
  }

  console.log(`${manifest.name} manifest OK (${manifest.version})`);
}

function assertFile(relativePath, referencedBy) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    const origin = referencedBy ? ` (referenced by ${referencedBy})` : "";
    missing.push(`${relativePath}${origin}`);
  }
}

function assertHtmlAssets(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }

  const html = fs.readFileSync(fullPath, "utf8");
  const directory = path.dirname(relativePath);
  const assetPattern =
    /<(?:link|script|img)\b[^>]+(?:href|src)=["']([^"']+)["'][^>]*>/gi;
  let match = assetPattern.exec(html);

  while (match) {
    const asset = match[1];
    if (!/^(?:https?:|data:|chrome-extension:)/i.test(asset)) {
      assertFile(path.join(directory, asset), relativePath);
    }

    match = assetPattern.exec(html);
  }
}

function assertIconFiles(iconConfig, field) {
  if (typeof iconConfig === "string") {
    assertFile(iconConfig, field);
    return;
  }

  for (const [size, iconPath] of Object.entries(iconConfig)) {
    if (!/^\d+$/.test(String(size)) || Number(size) <= 0) {
      errors.push(
        `${field} has icon size key "${size}"; expected a positive integer pixel size.`,
      );
    }

    assertFile(iconPath, `${field}[${size}]`);
  }
}

function assertContentScriptBundles() {
  const bundles = manifest.content_scripts || [];

  if (bundles.length === 0) {
    errors.push(
      "manifest declares no content_scripts; no site could ever activate.",
    );
    return;
  }

  for (const [index, bundle] of bundles.entries()) {
    const label = `content_scripts[${index}]`;

    if (!Array.isArray(bundle.matches) || bundle.matches.length === 0) {
      errors.push(`${label}.matches is empty; the bundle would never run.`);
    }

    const seen = new Set();
    for (const file of [].concat(bundle.js || [], bundle.css || [])) {
      if (seen.has(file)) {
        errors.push(
          `${label} lists "${file}" more than once; drop the duplicate entry.`,
        );
      }
      seen.add(file);
    }
  }

  // bundles share one global scope, so registration order must respect
  // dependencies. pairs stay enforceable only while both files are declared.
  const loadOrder = bundles.flatMap((bundle) => bundle.js || []);
  const requiredOrderPairs = [
    ["src/shared/defaults.js", "src/shared/settings.js"],
    ["src/shared/settings.js", "src/content/platforms.js"],
    ["src/content/platforms.js", "src/content/media.js"],
    ["src/content/media.js", "src/content/automation.js"],
    ["src/content/automation.js", "src/content/youtube-controller.js"],
    ["src/content/youtube-controller.js", "src/content/watch-dash.js"],
  ];

  for (const [before, after] of requiredOrderPairs) {
    const beforeIndex = loadOrder.indexOf(before);
    const afterIndex = loadOrder.indexOf(after);

    if (beforeIndex === -1 || afterIndex === -1) {
      continue;
    }

    if (beforeIndex >= afterIndex) {
      errors.push(
        `content_scripts must load "${before}" before "${after}", got positions ${beforeIndex} and ${afterIndex}: ${JSON.stringify(loadOrder)}`,
      );
    }
  }
}

function assertMatchPatternSyntax(patterns, field) {
  // <scheme>://<host>/<path> where host may be "*", "*.<domain>" or a plain
  // host; file keeps an optional host but the path part is mandatory.
  const patternRegex =
    /^(\*|https?|file|ws|wss):\/\/(\*|\*(?:\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)|\[?[0-9A-Fa-f:.]+\]?|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(\/.*)$/;

  for (const pattern of patterns) {
    if (!patternRegex.test(pattern)) {
      errors.push(
        `${field} has malformed match pattern "${pattern}". Expected "<scheme>://<host>/<path>", e.g. "*://*.example.com/*".`,
      );
    }
  }
}

function collectContentScriptHosts() {
  const hosts = new Set();

  for (const contentScript of manifest.content_scripts || []) {
    for (const host of extractManifestHosts(contentScript.matches || [])) {
      hosts.add(host);
    }
  }

  return hosts;
}

function assertHostPermissionParity() {
  const permissionHosts = extractManifestHosts(manifest.host_permissions || []);
  const scriptHosts = collectContentScriptHosts();

  for (const host of permissionHosts) {
    if (!scriptHosts.has(host)) {
      errors.push(
        `host_permissions grants "${host}" but no content_scripts.matches entry covers it; either add a matching content script pattern or drop the permission.`,
      );
    }
  }

  for (const host of scriptHosts) {
    if (!permissionHosts.has(host)) {
      errors.push(
        `content_scripts.matches covers "${host}" but host_permissions omits it; injection would fail at runtime.`,
      );
    }
  }
}

function assertWebAccessibleResourceCoverage() {
  const scriptHosts = collectContentScriptHosts();

  for (const resourceGroup of manifest.web_accessible_resources || []) {
    for (const match of resourceGroup.matches || []) {
      for (const host of extractManifestHosts([match])) {
        if (!scriptHosts.has(host)) {
          errors.push(
            `web_accessible_resources exposes assets on "${match}" but no content script runs on ${host}; the bridge would never be injected there.`,
          );
        }
      }
    }
  }
}

function assertCommandDescriptions() {
  for (const [id, command] of Object.entries(manifest.commands || {})) {
    if (
      !command ||
      typeof command.description !== "string" ||
      command.description.length === 0
    ) {
      errors.push(
        `command "${id}" needs a non-empty description (watch for a typo like "descritpion").`,
      );
    }
  }
}

function assertNoForbiddenMatchPatterns(patterns, field) {
  const forbidden = new Set(["*://*/web/*", "*://*/jellyfin/*", "*://*/*"]);

  for (const pattern of patterns) {
    if (forbidden.has(pattern)) {
      errors.push(
        `${field} contains broad match pattern ${pattern}. Use explicit hosts or per-site activation.`,
      );
    }
  }
}

function assertManifestHostCoverage() {
  const registryHosts = loadPlatformRegistryHosts();
  const hostPermissionHosts = extractManifestHosts(
    manifest.host_permissions || [],
  );
  const contentScriptHosts = new Set();

  for (const contentScript of manifest.content_scripts || []) {
    for (const host of extractManifestHosts(contentScript.matches || [])) {
      contentScriptHosts.add(host);
    }
  }

  assertHostSetContainsRegistryHosts(
    hostPermissionHosts,
    registryHosts,
    "host_permissions",
  );
  assertHostSetContainsRegistryHosts(
    contentScriptHosts,
    registryHosts,
    "content_scripts.matches",
  );
  assertNoHostsOutsideRegistry(
    hostPermissionHosts,
    registryHosts,
    "host_permissions",
  );
  assertNoHostsOutsideRegistry(
    contentScriptHosts,
    registryHosts,
    "content_scripts.matches",
  );
}

function assertPrimaryContentScriptBundle() {
  const [contentScript] = manifest.content_scripts || [];

  if (
    !contentScript ||
    !Array.isArray(contentScript.js) ||
    contentScript.js.length === 0
  ) {
    errors.push(
      "manifest must declare a primary content script bundle for optional-site injection.",
    );
  }
}

function loadPlatformRegistryHosts() {
  const context = {
    globalThis: {},
  };
  context.globalThis = context;

  vm.runInNewContext(
    fs.readFileSync(path.join(root, "src/content/platforms.js"), "utf8"),
    context,
    {
      filename: "src/content/platforms.js",
    },
  );

  return new Set(
    context.WatchDashPlatforms.flatMap(
      (platform) => platform.hostPatterns || [],
    )
      .map(normalizeHost)
      .filter(Boolean),
  );
}

function extractManifestHosts(patterns) {
  return new Set(patterns.map(extractManifestHost).filter(Boolean));
}

function extractManifestHost(pattern) {
  const match = /^(?:\*|https?|file):\/\/([^/]+)\//.exec(pattern);

  if (!match) {
    return "";
  }

  return normalizeHost(match[1]);
}

function normalizeHost(host) {
  const normalized = String(host || "")
    .toLowerCase()
    .replace(/^\*\./, "");
  // loopback hosts are gated detector-side (jellyfin), not by registry
  // patterns, so they stay exempt; keep the list exact - no ::/0 or
  // arbitrary ipv6 hosts
  if (
    !normalized ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127\.0\.0\.1$/.test(normalized)
  ) {
    return "";
  }

  return normalized;
}

function assertHostSetContainsRegistryHosts(
  manifestHosts,
  registryHosts,
  field,
) {
  for (const registryHost of registryHosts) {
    if (!manifestHosts.has(registryHost)) {
      errors.push(
        `${field} is missing platform registry host ${registryHost}.`,
      );
    }
  }
}

function assertNoHostsOutsideRegistry(manifestHosts, registryHosts, field) {
  for (const manifestHost of manifestHosts) {
    if (!registryHosts.has(manifestHost)) {
      errors.push(
        `${field} contains ${manifestHost}, which is not listed in the platform registry.`,
      );
    }
  }
}

function assertSettingsNormalization() {
  const context = {
    globalThis: {},
  };
  context.globalThis = context;

  for (const relativePath of [
    "src/shared/defaults.js",
    "src/shared/settings.js",
  ]) {
    vm.runInNewContext(
      fs.readFileSync(path.join(root, relativePath), "utf8"),
      context,
      {
        filename: relativePath,
      },
    );
  }

  const settingsTools = context.WatchDashSettings;
  const normalized = settingsTools.normalize({
    targetSpeed: 999,
    minSpeed: 16,
    maxSpeed: 9999,
    youtubeAdSpeed: 9999,
    unknownInjectedKey: "must-not-survive",
  });

  if (Object.prototype.hasOwnProperty.call(normalized, "unknownInjectedKey")) {
    errors.push(
      `settings normalization must strip unknown keys; got normalized.unknownInjectedKey=${JSON.stringify(normalized.unknownInjectedKey)}.`,
    );
  }

  if (
    normalized.maxSpeed > 16 ||
    normalized.youtubeAdSpeed > 16 ||
    normalized.targetSpeed > 16
  ) {
    errors.push(
      `settings normalization must clamp speed settings to <= 16; got targetSpeed=${normalized.targetSpeed}, minSpeed=${normalized.minSpeed}, maxSpeed=${normalized.maxSpeed}, youtubeAdSpeed=${normalized.youtubeAdSpeed}.`,
    );
  }

  if (normalized.minSpeed < 0.25 || normalized.targetSpeed < 0.25) {
    errors.push(
      `settings normalization must clamp speed settings to >= 0.25; got targetSpeed=${normalized.targetSpeed}, minSpeed=${normalized.minSpeed}, maxSpeed=${normalized.maxSpeed}.`,
    );
  }

  const inverted = settingsTools.normalize({
    minSpeed: 10,
    maxSpeed: 1,
    targetSpeed: 8,
  });

  if (
    inverted.minSpeed !== 0.25 ||
    inverted.maxSpeed !== 16 ||
    inverted.targetSpeed !== 8
  ) {
    errors.push(
      `settings normalization must reset inverted speed bounds to 0.25/16 before clamping targetSpeed (expected minSpeed=0.25, maxSpeed=16, targetSpeed=8); got minSpeed=${inverted.minSpeed}, maxSpeed=${inverted.maxSpeed}, targetSpeed=${inverted.targetSpeed}.`,
    );
  }
}

function assertPopupSettingsBindings() {
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "src/shared/defaults.js"), "utf8"),
    context,
    {
      filename: "src/shared/defaults.js",
    },
  );

  const popup = fs.readFileSync(
    path.join(root, manifest.action.default_popup),
    "utf8",
  );
  const bindings = new Set(
    Array.from(
      popup.matchAll(/<input\b[^>]*\bdata-setting="([^"]+)"[^>]*>/g),
      (match) => match[1],
    ),
  );
  const booleanSettings = Object.entries(
    context.WatchDashDefaults.defaultSettings,
  )
    .filter(([, value]) => typeof value === "boolean")
    .map(([key]) => key);

  for (const key of booleanSettings) {
    if (!bindings.has(key)) {
      errors.push(
        `popup is missing a data-setting binding for boolean setting ${key}.`,
      );
    }
  }

  for (const key of bindings) {
    if (!booleanSettings.includes(key)) {
      errors.push(
        `popup data-setting ${key} does not map to a boolean default setting.`,
      );
    }
  }

  for (const id of ["speed", "qualityTarget"]) {
    if (
      !new RegExp(
        `<input\\b[^>]*\\bid="${id}"[^>]*\\baria-label="[^"]+"[^>]*>`,
      ).test(popup)
    ) {
      errors.push(`popup range ${id} must have an accessible name.`);
    }
  }
}

function assertSourceSyntax() {
  for (const relativePath of listJavaScriptFiles(path.join(root, "src"))) {
    try {
      new vm.Script(fs.readFileSync(path.join(root, relativePath), "utf8"), {
        filename: relativePath,
      });
    } catch (error) {
      errors.push(
        `${relativePath} has invalid JavaScript syntax: ${error.message}`,
      );
    }
  }
}

function listJavaScriptFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listJavaScriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(path.relative(root, fullPath));
    }
  }

  return files;
}
