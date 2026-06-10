const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const missing = [];
const errors = [];

function assertFile(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    missing.push(relativePath);
  }
}

if (manifest.action && manifest.action.default_popup) {
  assertFile(manifest.action.default_popup);
  assertHtmlAssets(manifest.action.default_popup);
}

if (manifest.icons) {
  assertIconFiles(manifest.icons);
}

if (manifest.action && manifest.action.default_icon) {
  assertIconFiles(manifest.action.default_icon);
}

if (manifest.background && manifest.background.service_worker) {
  assertFile(manifest.background.service_worker);
}

for (const contentScript of manifest.content_scripts || []) {
  for (const jsFile of contentScript.js || []) {
    assertFile(jsFile);
  }

  for (const cssFile of contentScript.css || []) {
    assertFile(cssFile);
  }
}

for (const resourceGroup of manifest.web_accessible_resources || []) {
  for (const resource of resourceGroup.resources || []) {
    assertFile(resource);
  }

  for (const match of resourceGroup.matches || []) {
    if (match === "*://*/*") {
      errors.push("web_accessible_resources must not expose assets to every origin.");
    }
  }
}

assertNoForbiddenMatchPatterns(manifest.host_permissions || [], "host_permissions");

for (const contentScript of manifest.content_scripts || []) {
  assertNoForbiddenMatchPatterns(contentScript.matches || [], "content_scripts.matches");
}

assertSettingsNormalization();

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

function assertHtmlAssets(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }

  const html = fs.readFileSync(fullPath, "utf8");
  const directory = path.dirname(relativePath);
  const assetPattern = /<(?:link|script|img)\b[^>]+(?:href|src)=["']([^"']+)["'][^>]*>/gi;
  let match = assetPattern.exec(html);

  while (match) {
    const asset = match[1];
    if (!/^(?:https?:|data:|chrome-extension:)/i.test(asset)) {
      assertFile(path.join(directory, asset));
    }

    match = assetPattern.exec(html);
  }
}

function assertIconFiles(iconConfig) {
  if (typeof iconConfig === "string") {
    assertFile(iconConfig);
    return;
  }

  for (const iconPath of Object.values(iconConfig)) {
    assertFile(iconPath);
  }
}

function assertNoForbiddenMatchPatterns(patterns, field) {
  const forbidden = new Set([
    "*://*/web/*",
    "*://*/jellyfin/*",
    "*://*/*"
  ]);

  for (const pattern of patterns) {
    if (forbidden.has(pattern)) {
      errors.push(`${field} contains broad match pattern ${pattern}. Use explicit hosts or per-site activation.`);
    }
  }
}

function assertSettingsNormalization() {
  const context = {
    globalThis: {}
  };
  context.globalThis = context;

  for (const relativePath of [
    "src/shared/defaults.js",
    "src/shared/settings.js"
  ]) {
    vm.runInNewContext(fs.readFileSync(path.join(root, relativePath), "utf8"), context, {
      filename: relativePath
    });
  }

  const settingsTools = context.WatchDashSettings;
  const normalized = settingsTools.normalize({
    targetSpeed: 999,
    minSpeed: 16,
    maxSpeed: 9999,
    youtubeAdSpeed: 9999,
    unknownInjectedKey: "must-not-survive"
  });

  if (Object.prototype.hasOwnProperty.call(normalized, "unknownInjectedKey")) {
    errors.push("settings normalization must strip unknown keys.");
  }

  if (normalized.maxSpeed > 16 || normalized.youtubeAdSpeed > 16 || normalized.targetSpeed > 16) {
    errors.push("settings normalization must clamp speed settings to the supported range.");
  }

  const inverted = settingsTools.normalize({
    minSpeed: 10,
    maxSpeed: 1,
    targetSpeed: 8
  });

  if (inverted.minSpeed !== 0.25 || inverted.maxSpeed !== 16 || inverted.targetSpeed !== 8) {
    errors.push("settings normalization must reset inverted speed bounds before clamping targetSpeed.");
  }
}
