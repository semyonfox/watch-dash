(function registerAdapterDetection(root) {
  function hasElementIn(pageDocument, selector) {
    if (!pageDocument || typeof pageDocument.querySelector !== "function") {
      return false;
    }

    try {
      return Boolean(pageDocument.querySelector(selector));
    } catch (error) {
      return false;
    }
  }

  function isLocalStreamHost(host) {
    const value = String(host || "")
      .toLowerCase()
      .replace(/\.$/, "");

    return (
      value === "localhost" ||
      value === "::1" ||
      value === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(value)
    );
  }

  function isJellyfinPage(context) {
    const pageDocument =
      context && context.document ? context.document : document;
    const host = context && context.host ? context.host : location.hostname;
    const path = String(
      context && context.path ? context.path : location.pathname || "",
    ).toLowerCase();
    const title = String(pageDocument.title || "").toLowerCase();
    const pathSignal = /^\/(?:web|jellyfin)(?:\/|$)/.test(path);
    const appMetaSignal = [
      "meta[name='application-name'][content*='Jellyfin' i]",
      "meta[name='apple-mobile-web-app-title'][content*='Jellyfin' i]",
    ].some((selector) => hasElementIn(pageDocument, selector));
    const assetSignal = [
      "link[href*='jellyfin' i]",
      "script[src*='jellyfin' i]",
    ].some((selector) => hasElementIn(pageDocument, selector));
    const titleSignal = title.includes("jellyfin");
    const dataSignal = hasElementIn(
      pageDocument,
      "[data-app-name*='jellyfin' i]",
    );
    const classSignal =
      hasElementIn(pageDocument, "[class*='jellyfin' i]") &&
      (titleSignal || pathSignal || assetSignal);
    let score = 0;

    if (appMetaSignal) {
      score += 2;
    }

    if (assetSignal) {
      score += 1;
    }

    if (pathSignal) {
      score += 1;
    }

    if (titleSignal) {
      score += 1;
    }

    if (dataSignal) {
      score += 1;
    }

    if (classSignal) {
      score += 1;
    }

    // loopback installs only need two corroborating signals; remote hosts enabled
    // per site must carry the jellyfin app-shell marker so lookalike pages stay inert.
    if (!isLocalStreamHost(host)) {
      return appMetaSignal && score >= 2;
    }

    return score >= 2;
  }

  function isPrimeVideoPage({ host, path }) {
    const normalizedHost = String(host || "")
      .replace(/^www\./, "")
      .toLowerCase();
    const normalizedPath = String(path || "").toLowerCase();

    if (
      normalizedHost === "primevideo.com" ||
      normalizedHost.endsWith(".primevideo.com")
    ) {
      return true;
    }

    if (!/^amazon\./.test(normalizedHost)) {
      return false;
    }

    return [
      "/gp/video/",
      "/video/detail/",
      "/detail/",
      "/amazonvideo/",
      "/primevideo/",
    ].some((pattern) => normalizedPath.startsWith(pattern));
  }

  root.WatchDashAdapterDetection = Object.freeze({ isJellyfinPage, isPrimeVideoPage });
})(globalThis);
