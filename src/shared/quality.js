(function registerQualityGuidance(root) {
  function inspect(navigator, video) {
    const ua = String(navigator?.userAgent || "");
    const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox"
      : /Chrome\//.test(ua) ? "Chromium" : /Safari\//.test(ua) ? "Safari" : "Unknown browser";
    const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS"
      : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "macOS"
      : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
    const codecs = Object.entries({ H264: 'video/mp4; codecs="avc1.42E01E"', HEVC: 'video/mp4; codecs="hvc1.1.6.L93.B0"', AV1: 'video/mp4; codecs="av01.0.05M.08"' }).map(([name, mime]) => {
      let support = "unavailable";
      try {
        const result = video?.canPlayType?.(mime);
        if (result === "probably" || result === "maybe") support = result;
        else if (result === "") support = "not reported";
      } catch {}
      return `${name}: ${support}`;
    });
    return { browser, os, codecs, encryptedMediaApi: typeof navigator?.requestMediaKeySystemAccess === "function" };
  }

  const serviceHints = Object.freeze({
    netflix: "Check your plan, title availability and account playback quality. For Windows Ultra HD, check Netflix's current OS, browser, HEVC and display requirements. macOS has different browser limits. Use Playback Settings above and the official requirements below.",
    "prime-video": "Check the player's streaming quality choice and title availability. Browser playback can differ from the Prime Video app or a TV device.",
    "disney-plus": "Check the app's data usage setting and title formats. Browser playback may have different limits from a supported TV device.",
    "hbo-max": "Check your subscription tier, title format and device support. A 4K title badge does not confirm 4K browser playback.",
    hulu: "Check the selected title, streaming quality setting and supported browser. Live streams and on-demand titles may use different formats.",
    "apple-tv-plus": "Check title availability and Apple's device requirements. Browser and TV app playback may offer different formats.",
    peacock: "Check title availability and supported devices. A title's UHD availability does not establish browser support.",
    "paramount-plus": "Check the plan, title and supported device list. Browser and native app capabilities may differ.",
    youtube: "YouTube quality requests stay in its dedicated controller. Available renditions, adaptive playback and buffering can keep decoded quality below the target.",
    crunchyroll: "Check the episode's available quality choices and player setting. Source resolution varies by release.",
    tubi: "Check the title's source quality and connection. An extension target cannot add a rendition the service does not provide.",
    "roku-channel": "Check the title or channel's available formats and device support. Live and on-demand formats can differ.",
    "pluto-tv": "Live channels and on-demand titles can have different source resolutions. The target cannot raise the source resolution.",
    jellyfin: "Check the Jellyfin playback dashboard for direct play or transcoding. Server bitrate limits, source codecs and client compatibility can lower resolution.",
  });

  function guidance(platform, capabilities) {
    return [
      `${capabilities.browser} on ${capabilities.os}. Browser identification is approximate.`,
      capabilities.codecs.join(". "),
      `Encrypted Media API: ${capabilities.encryptedMediaApi ? "present" : "not exposed"}. This does not verify a DRM module, licence, security level or service certification.`,
      serviceHints[platform] || "Check the player's quality selection and the source video's available renditions.",
      "A supported codec is only a playback hint. Plan, account settings, network, DRM, display resolution and HDCP can still limit protected playback. WatchDash cannot measure your plan or HDCP chain and does not probe DRM licences.",
    ].join("\n\n");
  }

  root.WatchDashQuality = Object.freeze({ inspect, guidance });
})(globalThis);
