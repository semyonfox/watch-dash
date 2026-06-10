# WatchDash: Speed Control & Auto Skip

Manifest V3 browser extension for streaming playback utilities across the major web players. The current adapter set covers Netflix, Prime Video/Amazon, Disney+, HBO Max/Max, Hulu, Apple TV+, Peacock, Paramount+, YouTube, Crunchyroll, Tubi, The Roku Channel, Pluto TV, and local Jellyfin.

## Current Features

- Playback speed control from 0.25x to 16x.
- Presets and popup controls.
- Keyboard commands and in-page hotkeys:
  - `+` or `=` increase speed.
  - `-` decrease speed.
  - `\` reset to 1x.
  - `Alt+[` and `Alt+]` still work as alternate decrease/increase shortcuts.
- Platform coverage:
  - Full adapter detection and speed controls on Netflix, Prime Video/Amazon, Disney+, HBO Max/Max, Hulu, Apple TV+, Peacock, Paramount+, YouTube, Crunchyroll, Tubi, The Roku Channel, Pluto TV, and local Jellyfin.
  - Jellyfin is detected by app signals on localhost or 127.0.0.1 `/web/` or `/jellyfin/` routes.
- Platform-specific popup controls:
  - YouTube exposes quality, ad skip, and ad speed controls.
  - Other services only show the automation toggles their adapter can use.
- YouTube-specific controls:
  - Apply the quality target to YouTube's player when available.
  - Temporarily speed up ads to 16x, then restore the pre-ad playback speed when the ad ends or is skipped.
  - Auto-click YouTube's skip-ad button when it appears.
- Button automation where the platform exposes accessible player controls:
  - Skip intro.
  - Skip recap.
  - Skip credits.
  - Play next episode/video after the current video ends, with Netflix end-card next buttons handled near the end of playback.
  - Continue playing.
- Playback diagnostics:
  - Active platform.
  - Current rate.
  - Decoded video resolution when the browser exposes it.
  - Dropped frame counter when available.
- Quality target slider for diagnostics. It compares the decoded resolution with your target, but it does not force account, browser, or DRM quality.
- Netflix playback settings shortcut when the active platform exposes a settings URL.

## Platform Priority

The first broad platform wave follows current U.S. popularity signals:

- JustWatch Q1 2026 U.S. SVOD engagement: Netflix, Prime Video, Disney+, Apple TV+, HBO Max, and Hulu are the leading cluster. Source: https://www.contentgrip.com/streaming-market-share-q1-2026/
- JustWatch 2025 U.S. engagement confirms the same major SVOD set, with Peacock and Paramount+ in the next tier. Source: https://www.justwatch.com/us/press/netflix-paramount-warner-bros
- Nielsen's Gauge treats YouTube as a top TV viewing distributor and tracks major free/ad-supported services, so YouTube, Tubi, The Roku Channel, and Pluto TV are included even though they are not classic SVOD services. Source: https://www.nielsen.com/data-center/the-gauge/
- Local Jellyfin is included because it is a practical self-hosted target even though it does not appear in paid market-share rankings. Arbitrary self-hosted domains should use explicit per-site activation before automation is enabled.

## Load Unpacked

1. Open `brave://extensions`, `chrome://extensions`, or `edge://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select the cloned repository folder.

## Validate

```powershell
npm run check
```

No build step is required. The files in this directory are the extension.

## Quality Approach

The first implementation does not copy or patch Netflix player internals. Higher quality playback is started as diagnostics, a target slider, and account/browser guidance because current high-quality forcing techniques are brittle, browser/DRM dependent, and often rely on patched proprietary player bundles.

See [docs/research.md](docs/research.md) for market notes, licensing notes, and the quality roadmap.

## Code Shape

- `src/shared/defaults.js` owns default setting values.
- `src/shared/settings.js` owns setting normalization, numeric clamping, and quality target formatting.
- `src/content/platforms.js` owns platform adapters, hosts, selectors, and platform capabilities.
- `src/content/media.js` owns active video selection and playback-quality reads.
- `src/content/automation.js` owns action target lookup, visibility checks, and click dispatch.
- `src/content/watch-dash.js` owns the generic runtime loop: platform detection, speed policy, automation orchestration, status, and hotkeys.
- `src/content/youtube-controller.js` owns YouTube-specific content-script behavior such as ad detection and quality bridge messaging.
- `src/content/youtube-bridge.js` runs in the page context so it can call YouTube's player quality APIs.

## Idea Credits

This starts as a clean-room MIT extension, but the product shape is informed by existing tools:

- Multi Skipper: broad multi-platform skip coverage.
- Netflix higher quality: quality-forcing niche and Netflix playback constraints.
- Netflix Speeder: simple speed-first control model.
- NflxIntroSkip: focused MutationObserver skip-intro approach.
- Video Speed Controller: generic HTML5 video speed control and presets.
- Streaming enhanced: broad streaming utility backlog.
- Intro Skipper: privacy-first, zero-configuration positioning.
- Netflix Force 4K: browser capability and DRM reality checks.
