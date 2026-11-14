(function registerActions(root) {
  const { action, extendAction, withTestIdSelectors, commonActions, commonContinuePlaying, commonSkipIntro, commonSkipRecap, commonSkipCredits, commonNextEpisode } = root.WatchDashAdapterCommon;
  const netflixActions = [
    extendAction(commonContinuePlaying, {
      selectors: [
        "button[data-uia='continue-playing-button']",
        "[data-uia='continue-playing-button']",
        "button[data-uia*='continue-playing' i]",
        "[data-uia*='continue-playing' i]",
      ],
    }),
    extendAction(commonSkipIntro, {
      selectors: [
        "button[data-uia='player-skip-intro']",
        "[data-uia='player-skip-intro']",
        "button[data-uia*='skip-intro' i]",
        "[data-uia*='skip-intro' i]",
        "button[data-uia*='skipintro' i]",
        "[data-uia*='skipintro' i]",
      ],
    }),
    extendAction(commonSkipRecap, {
      selectors: [
        "button[data-uia='player-skip-recap']",
        "[data-uia='player-skip-recap']",
        "button[data-uia*='skip-recap' i]",
        "[data-uia*='skip-recap' i]",
        "button[data-uia*='skiprecap' i]",
        "[data-uia*='skiprecap' i]",
      ],
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
        ".skip-credits > a",
      ],
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
        "[data-uia*='next-episode' i]",
      ],
    }),
  ];

  Object.assign(root.WatchDashAdapterActions ||= {}, { netflixActions });
})(globalThis);
