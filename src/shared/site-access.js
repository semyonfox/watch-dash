(function registerSiteAccess(root) {
  function isCustomPattern(pattern, manifest) {
    const match = /^https?:\/\/([^/*]+)\/\*$/.exec(pattern || "");
    if (!match) return false;
    return !(manifest.host_permissions || []).some(builtin => {
      const parts = /^(\*|https?):\/\/([^/]+)\//.exec(builtin);
      if (!parts || (parts[1] !== "*" && !pattern.startsWith(parts[1] + ":"))) return false;
      const host = parts[2].replace(/^\*\./, "");
      return match[1] === host || (parts[2].startsWith("*.") && match[1].endsWith("." + host));
    });
  }

  function list(api, callback) {
    if (!api?.permissions?.getAll || !api?.scripting?.getRegisteredContentScripts) {
      callback(null, "Site access management is unavailable in this browser.");
      return;
    }
    api.permissions.getAll(permissions => {
      if (api.runtime.lastError) { callback(null, "Could not read site permissions. Retry."); return; }
      api.scripting.getRegisteredContentScripts(scripts => {
        if (api.runtime.lastError) { callback(null, "Could not read registered sites. Retry."); return; }
        const manifest = api.runtime.getManifest();
        const owned = scripts.filter(script => script.id.startsWith("watchdash_"));
        const patterns = new Set([...(permissions.origins || []), ...owned.flatMap(script => script.matches || [])]);
        callback([...patterns].filter(pattern => isCustomPattern(pattern, manifest)).sort().map(pattern => ({
          pattern,
          ids: owned.filter(script => script.matches?.includes(pattern)).map(script => script.id),
        })), null);
      });
    });
  }

  function remove(api, site, callback) {
    if (!isCustomPattern(site.pattern, api.runtime.getManifest())) {
      callback(false, "Built-in access is managed by the browser.");
      return;
    }
    if (!api.permissions.remove) { callback(false, "Permission removal is unavailable. Use browser extension settings."); return; }
    function revoke() {
      api.permissions.remove({origins: [site.pattern]}, removed => {
        if (api.runtime.lastError || !removed) {
          callback(false, "Script registration removed, but permission removal failed. Retry or use browser extension settings.");
          return;
        }
        callback(true, "Site removed. Reload any existing tabs to stop scripts already loaded.");
      });
    }
    if (!site.ids.length) { revoke(); return; }
    api.scripting.unregisterContentScripts({ids: site.ids}, () => {
      if (api.runtime.lastError) { callback(false, "Could not unregister this site. Access was kept. Retry."); return; }
      site.ids = [];
      revoke();
    });
  }

  root.WatchDashSiteAccess = Object.freeze({ list, remove, isCustomPattern });
})(globalThis);
