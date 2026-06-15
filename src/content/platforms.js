(function registerWatchDashPlatforms(root) {
  function action(config) {
    return Object.assign({
      cooldownMs: 0,
      selectors: [],
      text: []
    }, config);
  }

  function extendAction(base, extension) {
    return Object.assign({}, base, extension || {}, {
      selectors: [].concat(extension && extension.selectors ? extension.selectors : [], base.selectors || []),
      text: [].concat(extension && extension.text ? extension.text : [], base.text || [])
    });
  }

  function hasElement(selector) {
    try {
      return Boolean(document.querySelector(selector));
    } catch (error) {
      return false;
    }
  }

  function isJellyfinPage() {
    const title = String(document.title || "").toLowerCase();
    const path = String(location.pathname || "").toLowerCase();
    const pathSignal = /^\/(?:web|jellyfin)(?:\/|$)/.test(path);
    const appMetaSignal = [
      "meta[name='application-name'][content*='Jellyfin' i]",
      "meta[name='apple-mobile-web-app-title'][content*='Jellyfin' i]"
    ].some(hasElement);
    const assetSignal = [
      "link[href*='jellyfin' i]",
      "script[src*='jellyfin' i]"
    ].some(hasElement);
    const titleSignal = title.includes("jellyfin");
    const dataSignal = hasElement("[data-app-name*='jellyfin' i]");
    const classSignal = hasElement("[class*='jellyfin' i]") && (titleSignal || pathSignal || assetSignal);
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

    return score >= 2;
  }

  const commonContinuePlaying = action({
    id: "continue-playing",
    setting: "continuePlaying",
    label: "Continue playing",
    selectors: [
      "button[aria-label*='Continue Playing' i]",
      "button[aria-label*='Continue Watching' i]",
      "button[aria-label*='Keep Watching' i]",
      "button[aria-label*='Resume' i]",
      "[role='button'][aria-label*='Continue Playing' i]",
      "[role='button'][aria-label*='Continue Watching' i]",
      "[role='button'][aria-label*='Keep Watching' i]",
      "[role='button'][aria-label*='Resume' i]",
      "button[data-testid*='continue' i]",
      "button[data-test-id*='continue' i]",
      "button[data-automation-id*='continue' i]",
      "button[class*='continue' i]",
      "button[class*='resume' i]"
    ],
    text: [
      "Continue Playing",
      "Continue Watching",
      "Keep Watching",
      "Resume"
    ]
  });

  const commonSkipIntro = action({
    id: "skip-intro",
    setting: "skipIntros",
    label: "Skip intro",
    selectors: [
      "button[aria-label*='Skip Intro' i]",
      "[role='button'][aria-label*='Skip Intro' i]",
      "button[data-testid*='skip-intro' i]",
      "button[data-testid*='skipintro' i]",
      "button[data-test-id*='skip-intro' i]",
      "button[data-automation-id*='skip-intro' i]",
      "button[class*='skip-intro' i]",
      "button[class*='skipIntro' i]",
      "[class*='skip-intro' i]",
      "[class*='skipIntro' i]"
    ],
    text: [
      "Skip Intro"
    ]
  });

  const commonSkipRecap = action({
    id: "skip-recap",
    setting: "skipRecaps",
    label: "Skip recap",
    selectors: [
      "button[aria-label*='Skip Recap' i]",
      "[role='button'][aria-label*='Skip Recap' i]",
      "button[data-testid*='skip-recap' i]",
      "button[data-testid*='skiprecap' i]",
      "button[data-test-id*='skip-recap' i]",
      "button[data-automation-id*='skip-recap' i]",
      "button[class*='skip-recap' i]",
      "button[class*='skipRecap' i]",
      "[class*='skip-recap' i]",
      "[class*='skipRecap' i]"
    ],
    text: [
      "Skip Recap"
    ]
  });

  const commonSkipCredits = action({
    id: "skip-credits",
    setting: "skipCredits",
    label: "Skip credits",
    selectors: [
      "button[aria-label*='Skip Credits' i]",
      "button[aria-label*='Skip Credit' i]",
      "[role='button'][aria-label*='Skip Credits' i]",
      "[role='button'][aria-label*='Skip Credit' i]",
      "button[data-testid*='skip-credits' i]",
      "button[data-testid*='skipcredits' i]",
      "button[data-test-id*='skip-credits' i]",
      "button[data-automation-id*='skip-credits' i]",
      "button[class*='skip-credits' i]",
      "button[class*='skipCredits' i]",
      "[class*='skip-credits' i]",
      "[class*='skipCredits' i]"
    ],
    text: [
      "Skip Credits",
      "Skip Credit"
    ]
  });

  const commonNextEpisode = action({
    id: "next-episode",
    setting: "autoNextEpisode",
    type: "nextEpisode",
    label: "Next episode",
    cooldownMs: 90000,
    selectors: [
      "button[aria-label*='Next Episode' i]",
      "button[aria-label*='Play Next Episode' i]",
      "button[aria-label*='Play Next' i]",
      "[role='button'][aria-label*='Next Episode' i]",
      "[role='button'][aria-label*='Play Next Episode' i]",
      "[role='button'][aria-label*='Play Next' i]",
      "button[data-testid*='next-episode' i]",
      "button[data-testid*='nextepisode' i]",
      "button[data-test-id*='next-episode' i]",
      "button[data-automation-id*='next-episode' i]",
      "button[class*='next-episode' i]",
      "button[class*='nextEpisode' i]",
      "[class*='next-episode' i]",
      "[class*='nextEpisode' i]"
    ],
    text: [
      "Next Episode",
      "Play Next Episode",
      "Play Next"
    ]
  });

  const commonActions = [
    commonContinuePlaying,
    commonSkipIntro,
    commonSkipRecap,
    commonSkipCredits,
    commonNextEpisode
  ];

  const netflixActions = [
    extendAction(commonContinuePlaying, {
      selectors: [
        "button[data-uia='continue-playing-button']",
        "[data-uia='continue-playing-button']",
        "button[data-uia*='continue-playing' i]",
        "[data-uia*='continue-playing' i]"
      ]
    }),
    extendAction(commonSkipIntro, {
      selectors: [
        "button[data-uia='player-skip-intro']",
        "[data-uia='player-skip-intro']",
        "button[data-uia*='skip-intro' i]",
        "[data-uia*='skip-intro' i]",
        "button[data-uia*='skipintro' i]",
        "[data-uia*='skipintro' i]"
      ]
    }),
    extendAction(commonSkipRecap, {
      selectors: [
        "button[data-uia='player-skip-recap']",
        "[data-uia='player-skip-recap']",
        "button[data-uia*='skip-recap' i]",
        "[data-uia*='skip-recap' i]",
        "button[data-uia*='skiprecap' i]",
        "[data-uia*='skiprecap' i]"
      ]
    }),
    extendAction(commonSkipCredits, {
      selectors: [
        "button[data-uia='player-skip-credits']",
        "[data-uia='player-skip-credits']",
        "button[data-uia*='skip-credits' i]",
        "[data-uia*='skip-credits' i]",
        "button[data-uia*='skip-credit' i]",
        "[data-uia*='skip-credit' i]",
        "button[data-uia*='skipcredits' i]",
        "[data-uia*='skipcredits' i]",
        "button[data-uia*='skipcredit' i]",
        "[data-uia*='skipcredit' i]",
        ".skip-credits > a"
      ]
    }),
    extendAction(commonNextEpisode, {
      minProgressBeforeEnded: 0.95,
      maxRemainingSecondsBeforeEnded: 180,
      selectors: [
        "button[data-uia='next-episode-seamless-button']",
        "[data-uia='next-episode-seamless-button']",
        "button[data-uia='next-episode-button']",
        "[data-uia='next-episode-button']",
        "button[data-uia*='next-episode' i]",
        "[data-uia*='next-episode' i]"
      ]
    })
  ];

  const primeVideoActions = commonActions.map((item) => extendAction(item, {
    selectors: [
      `button[data-testid*='${item.id}' i]`,
      `[data-testid*='${item.id}' i]`
    ]
  }));

  const disneyActions = commonActions.map((item) => extendAction(item, {
    selectors: [
      `button[data-testid*='${item.id}' i]`,
      `[data-testid*='${item.id}' i]`
    ]
  }));

  const youtubeActions = [
    action({
      id: "skip-ad",
      setting: "youtubeAutoSkipAds",
      type: "adSkip",
      label: "Skip ad",
      cooldownMs: 900,
      selectors: [
        "#movie_player .video-ads button.ytp-ad-skip-button",
        "#movie_player .video-ads button.ytp-ad-skip-button-modern",
        "#movie_player .video-ads .ytp-ad-skip-button",
        "#movie_player .video-ads .ytp-ad-skip-button-modern",
        "#movie_player .video-ads .ytp-skip-ad-button",
        "#movie_player .ytp-ad-skip-button-container button",
        "#movie_player .ytp-ad-skip-button-container",
        "#movie_player button.ytp-ad-skip-button",
        "#movie_player button.ytp-ad-skip-button-modern",
        "#movie_player .ytp-ad-skip-button",
        "#movie_player .ytp-ad-skip-button-modern",
        "#movie_player .ytp-skip-ad-button",
        "#movie_player button[aria-label*='Skip Ad' i]",
        "#movie_player button[aria-label*='Skip Ads' i]",
        "#movie_player button[aria-label='Skip' i]",
        "#movie_player .video-ads [role='button'][aria-label*='Skip Ad' i]",
        "#movie_player .video-ads [role='button'][aria-label*='Skip Ads' i]",
        "#movie_player .video-ads [class*='ad-skip' i] button",
        "#movie_player .video-ads [class*='skip-ad' i] button",
        "#movie_player [class*='ad-skip' i] button",
        "#movie_player [class*='skip-ad' i] button"
      ],
      text: [
        "Skip Ad",
        "Skip Ads"
      ]
    }),
    action({
      id: "next-video",
      setting: "autoNextEpisode",
      type: "nextEpisode",
      label: "Next video",
      cooldownMs: 90000,
      minProgressBeforeEnded: 0.985,
      maxRemainingSecondsBeforeEnded: 8,
      selectors: [
        "#movie_player a.ytp-autonav-endscreen-upnext-play-button[role='button']",
        "#movie_player .ytp-autonav-endscreen-upnext-play-button",
        "#movie_player button.ytp-endscreen-next",
        "#movie_player .ytp-endscreen-next",
        "#movie_player a.ytp-next-button[role='button']",
        "#movie_player button.ytp-next-button",
        "#movie_player .ytp-next-button",
        "#movie_player a[aria-label*='Play next video' i]",
        "#movie_player [role='button'][aria-label*='Play next video' i]"
      ],
      text: [
        "Play next video",
        "Play Now",
        "Next video"
      ]
    })
  ];

  const jellyfinActions = [
    extendAction(commonContinuePlaying, {
      selectors: [
        "button[title*='Resume' i]"
      ]
    }),
    extendAction(commonSkipIntro, {
      selectors: [
        ".btnSkipIntro",
        "button[title*='Skip Intro' i]"
      ]
    }),
    extendAction(commonSkipRecap, {
      selectors: [
        ".btnSkipRecap",
        "button[title*='Skip Recap' i]"
      ]
    }),
    extendAction(commonSkipCredits, {
      selectors: [
        ".btnSkipCredits",
        "button[title*='Skip Credits' i]"
      ]
    }),
    extendAction(commonNextEpisode, {
      selectors: [
        ".btnNextTrack",
        "button[title*='Next Episode' i]"
      ]
    })
  ];

  root.WatchDashPlatforms = Object.freeze([
    {
      id: "netflix",
      label: "Netflix",
      hostPatterns: [
        "netflix.com"
      ],
      actions: netflixActions,
      playbackSettingsUrl: "https://www.netflix.com/settings/playback",
      watchUrlPatterns: [
        "/watch"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "prime-video",
      label: "Prime Video",
      hostPatterns: [
        "primevideo.com",
        "amazon.com",
        "amazon.co.uk",
        "amazon.de",
        "amazon.fr",
        "amazon.it",
        "amazon.es",
        "amazon.ca",
        "amazon.com.au",
        "amazon.co.jp",
        "amazon.in",
        "amazon.com.br",
        "amazon.com.mx",
        "amazon.nl"
      ],
      actions: primeVideoActions,
      watchUrlPatterns: [
        "/detail/",
        "/gp/video/",
        "/video/detail/",
        "/watch/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "disney-plus",
      label: "Disney+",
      hostPatterns: [
        "disneyplus.com"
      ],
      actions: disneyActions,
      watchUrlPatterns: [
        "/video/",
        "/movies/",
        "/series/",
        "/browse/entity-"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "hbo-max",
      label: "HBO Max / Max",
      hostPatterns: [
        "max.com",
        "hbomax.com"
      ],
      actions: commonActions,
      watchUrlPatterns: [
        "/video/",
        "/watch/",
        "/movie/",
        "/show/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "hulu",
      label: "Hulu",
      hostPatterns: [
        "hulu.com"
      ],
      actions: commonActions,
      watchUrlPatterns: [
        "/watch/",
        "/movie/",
        "/series/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "apple-tv-plus",
      label: "Apple TV+",
      hostPatterns: [
        "tv.apple.com"
      ],
      actions: commonActions,
      watchUrlPatterns: [
        "/watch/",
        "/movie/",
        "/show/",
        "/episode/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "peacock",
      label: "Peacock",
      hostPatterns: [
        "peacocktv.com"
      ],
      actions: commonActions,
      watchUrlPatterns: [
        "/watch/",
        "/stream-",
        "/movies/",
        "/series/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "paramount-plus",
      label: "Paramount+",
      hostPatterns: [
        "paramountplus.com"
      ],
      actions: commonActions,
      watchUrlPatterns: [
        "/shows/",
        "/movies/",
        "/video/",
        "/episodes/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "youtube",
      label: "YouTube",
      hostPatterns: [
        "youtube.com",
        "youtu.be"
      ],
      actions: youtubeActions,
      features: {
        youtubeQualityControls: true,
        youtubeAdControls: true
      },
      watchUrlPatterns: [
        "/watch",
        "/shorts/",
        "/embed/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "crunchyroll",
      label: "Crunchyroll",
      hostPatterns: [
        "crunchyroll.com"
      ],
      actions: commonActions,
      watchUrlPatterns: [
        "/watch/",
        "/series/",
        "/videos/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "tubi",
      label: "Tubi",
      hostPatterns: [
        "tubi.tv"
      ],
      actions: commonActions,
      watchUrlPatterns: [
        "/movies/",
        "/tv-shows/",
        "/video/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "roku-channel",
      label: "The Roku Channel",
      hostPatterns: [
        "therokuchannel.roku.com"
      ],
      actions: commonActions,
      watchUrlPatterns: [
        "/watch/",
        "/details/",
        "/movies/",
        "/tv-shows/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "pluto-tv",
      label: "Pluto TV",
      hostPatterns: [
        "pluto.tv"
      ],
      actions: commonActions,
      watchUrlPatterns: [
        "/live-tv/",
        "/on-demand/",
        "/movies/",
        "/series/"
      ],
      allowVideoSurfaceFallback: false
    },
    {
      id: "jellyfin",
      label: "Jellyfin",
      hostPatterns: [],
      detect: isJellyfinPage,
      actions: jellyfinActions,
      watchUrlPatterns: [
        "/web/",
        "/jellyfin/",
        "/video/"
      ],
      allowVideoSurfaceFallback: true
    }
  ]);
})(globalThis);
