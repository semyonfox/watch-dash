(function registerActions(root) {
  const { action, extendAction, withTestIdSelectors, commonActions, commonContinuePlaying, commonSkipIntro, commonSkipRecap, commonSkipCredits, commonNextEpisode } = root.WatchDashAdapterCommon;
  const jellyfinActions = [
    extendAction(commonContinuePlaying, {
      selectors: ["button[title*='Resume' i]"],
    }),
    extendAction(commonSkipIntro, {
      selectors: [".btnSkipIntro", "button[title*='Skip Intro' i]"],
    }),
    extendAction(commonSkipRecap, {
      selectors: [".btnSkipRecap", "button[title*='Skip Recap' i]"],
    }),
    extendAction(commonSkipCredits, {
      selectors: [".btnSkipCredits", "button[title*='Skip Credits' i]"],
    }),
    extendAction(commonNextEpisode, {
      selectors: [".btnNextTrack", "button[title*='Next Episode' i]"],
    }),
  ];

  Object.assign(root.WatchDashAdapterActions ||= {}, { jellyfinActions });
})(globalThis);
