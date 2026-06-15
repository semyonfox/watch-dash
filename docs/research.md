# WatchDash Research

Date: 2026-06-09

## Naming

The original working name, Stream Pilot, was dropped after finding multiple existing products and extensions using StreamPilot/Stream Pilot. CueGlide was also dropped. WatchDash: Speed Control & Auto Skip is the current working name for browser extension stores, with WatchDash as the short name.

## Market Notes

- June 2026 platform priority: JustWatch Q1 2026 U.S. SVOD engagement puts Netflix at 19%, Prime Video at 17%, Disney+ at 16%, Apple TV+ and HBO Max at 12%, and Hulu at 11%, with Peacock and Paramount+ behind them. The first broad WatchDash wave therefore covers Netflix, Prime Video/Amazon, Disney+, HBO Max/Max, Hulu, Apple TV+, Peacock, and Paramount+.
  Source: https://www.contentgrip.com/streaming-market-share-q1-2026/
- JustWatch's Jan-Sep 2025 U.S. SVOD report shows the same core market shape, with Prime Video, Netflix, Disney+, HBO Max, Hulu, Apple TV+, Paramount+, and Peacock Premium as the named services above the long tail.
  Source: https://www.justwatch.com/us/press/netflix-paramount-warner-bros
- Nielsen's Gauge remains the useful TV-viewing cross-check for non-SVOD services. Its 2026 data center tracks monthly U.S. TV viewing and the broader distributor view keeps YouTube large enough to support as a first-wave web video target. It also justifies including major free/ad-supported web players such as Tubi, The Roku Channel, and Pluto TV.
  Source: https://www.nielsen.com/data-center/the-gauge/
- Local Jellyfin is included outside the popularity ranking because a self-hosted player needs a detector-based adapter rather than a fixed domain adapter. Broad self-hosted domain support needs explicit per-site activation before automation is enabled.
- NflxIntroSkip is a small MIT Chrome/Firefox extension focused only on Netflix intro skipping. Its README describes a `MutationObserver` watching for Netflix's skip-intro button and clicking it when it appears.
  Source: https://github.com/gmertes/NflxIntroSkip
- Video Speed Controller positions itself as generic HTML5 video speed control across Netflix, YouTube, Prime Video, Twitch, and Disney+, with 0.25x to 4x controls, customizable hotkeys, site blacklist, and per-tab memory.
  Source: https://videospeed.net/
- Multi Skipper is covered by TechHive as a desktop Chromium extension for major streaming services. The review says it skips intros and recaps by default and accelerates through ad breaks, but notes occasional glitches and desktop-only limits.
  Source: https://www.techhive.com/article/2378550/skip-through-streaming-tv-ads-with-this-free-browser-extension.html
- Streaming enhanced is a broad GPL-3.0 project for Netflix, Prime Video, Disney+, Crunchyroll, HBO Max, and Paramount+. It includes auto-skip, ads, speed slider, fullscreen behavior, scroll volume, TMDB ratings, profile selection, and platform-specific cleanup. GPL means ideas are fine, but do not copy code into this MIT project.
  Source: https://github.com/Dreamlinerm/Netflix-Prime-Auto-Skip
- Intro Skipper advertises privacy-first, zero-configuration skipping across Netflix, Crunchyroll, and Hotstar, with Chrome, Firefox, and Edge support.
  Source: https://introskipper.dsourav.com/
- Netflix Force 4K is MIT and tackles browser capability detection for Edge/Windows 4K. It explicitly says it only fixes JavaScript-level detection and still requires real DRM/hardware support.
  Source: https://github.com/Pickle-Pixel/netflix-force-4k

## Current Netflix Constraints

- Netflix says browser playback speed is available on web browsers and mobile apps, but not while casting/mirroring or while using a web browser on an ad-supported plan.
  Source: https://help.netflix.com/en/node/116584
- Netflix's current browser requirements page lists Windows Edge 118+ and Chrome 117+ as up to Ultra HD 2160p when Ultra HD requirements are met. Windows Firefox and Opera are listed up to Full HD 1080p. On Mac, Safari is listed up to Ultra HD and Chrome is listed up to Full HD 1080p.
  Source: https://help.netflix.com/en/node/30081
- Netflix's Windows page says Ultra HD requires a plan that supports 4K, playback quality set to Auto or High, steady 15 Mbps+ connection, Windows 11 with latest updates, and Edge, Chrome, or the Netflix app. It also notes some Windows 11 devices need the HEVC extension from the Microsoft Store.
  Source: https://help.netflix.com/en/node/23931

## Product Direction

The useful niche is not "another Netflix-only button clicker"; it is a privacy-respecting streaming control layer with platform adapters:

- Base controls: speed, hotkeys, presets, per-site settings, per-tab status.
- Autopilot: intros, recaps, credits, next episode after the active video is ended or a platform-specific end-card next button is rendered near the end of playback, continue playing.
- YouTube-specific controls: the quality target can be applied through YouTube's page player API from a small bridge script, while ad speedup uses the standard HTML video playback rate and auto-skip clicks the visible skip-ad control. A June 2026 Playwright pass confirmed the current player surfaces around `#movie_player`, `.video-ads.ytp-ad-module`, modern skip-ad controls, `.ytp-progress-bar[role='slider']`, `.ytp-autonav-endscreen-upnext-play-button`, `.ytp-endscreen-next`, and `.ytp-next-button`. The content runtime now captures the pre-ad playback rate, applies 16x during YouTube ad mode, restores the captured rate once the ad ends or is skipped, and falls back to seeking the ad video near its end only while YouTube reports ad mode.
- Quality: diagnostics first, target slider for comparing decoded resolution against intended quality, then safe browser capability checks, account playback-settings shortcut, and platform/browser-specific guidance. Direct forcing should be isolated behind platform modules and must not copy patched proprietary player bundles.
- Extendability: shared files should own defaults/settings normalization, adapter files should own platform selectors and capabilities, media and automation helpers should own generic DOM/video mechanics, platform controller files should own platform-specific runtime behavior, and the engine should own orchestration, storage, popup messaging, and telemetry-free status.

## Idea Credits

These projects shaped the roadmap. This repo does not copy their code unless the license allows it and attribution is added.

| Source | License Status | Ideas Borrowed |
| --- | --- | --- |
| Multi Skipper: Skip ads, intros & recaps [QVI] | Local MIT license, copyright 2020 Pavel Bucka | Multi-platform skip coverage, intro/recap/credits/next actions, adapter backlog |
| Netflix - higher quality [QVI] | Local MIT license, copyright 2018 truedread, but patched player bundle excluded | Quality niche, Netflix player constraints, diagnostics-first roadmap |
| Netflix Speeder [QVI] | No local license file found | Speed-focused popup, wide 0.25x-16x range, simple step controls |
| NflxIntroSkip | MIT on GitHub | MutationObserver-driven skip-intro automation |
| Video Speed Controller | Public product/site; license not reused here | Generic HTML5 video speed controls, presets, per-site polish |
| Streaming enhanced | GPL-3.0 on GitHub | Broad streaming utility backlog; research-only for an MIT project |
| Intro Skipper | Public product/site; license not reused here | Privacy-first, zero-configuration positioning |
| Netflix Force 4K | MIT on GitHub | Browser capability checks and DRM limitation framing |

## Feature Backlog

- Per-platform permissions and adapter activation.
- Configurable selector packs with import/export.
- Per-site speed memory and blacklist.
- Fullscreen on play, double-click fullscreen, scroll volume.
- Skip delay and cooldown controls.
- Quality panel:
  - Browser/OS capability summary.
  - Netflix current decoded resolution and dropped frame counter.
  - Links to Netflix playback settings and diagnostics overlay instructions.
  - Optional Edge/Windows HEVC and DRM checklist.
- Optional ratings module is a later idea, but it needs a third-party API key and privacy review.

## Licensing Decision

This repository starts clean-room under MIT. Permissive sources can be reused only with attribution if copied. GPL sources are research-only unless this project changes license. Unlicensed installed bundles are idea-only. Patched Netflix player bundles are excluded until provenance and maintainability are proven.
