(function registerActions(root) {
  const { action, extendAction, withTestIdSelectors, commonActions, commonContinuePlaying, commonSkipIntro, commonSkipRecap, commonSkipCredits, commonNextEpisode } = root.WatchDashAdapterCommon;
  function buildPlatformActions(overrides) {
    return withTestIdSelectors(commonActions).map((item) =>
      overrides[item.id] ? extendAction(item, overrides[item.id]) : item,
    );
  }

  const primeVideoActions = buildPlatformActions({
    "skip-intro": {
      selectors: [
        ".skipElement",
        "button[class*='skippy' i]",
        "[class*='skippy' i]",
      ],
    },
    "skip-recap": {
      selectors: [
        ".skipElement",
        "button[class*='skippy' i]",
        "[class*='skippy' i]",
      ],
    },
  });

  const disneyActions = buildPlatformActions({
    "skip-intro": {
      selectors: [".skip__button", "[class*='skip__button' i]"],
    },
    "skip-credits": {
      selectors: [".skip__button"],
    },
  });

  const appleTvActions = buildPlatformActions({
    "skip-intro": {
      selectors: [
        ".atvwebplayersdk-skipelement-button",
        "button[class*='skipelement' i]",
        "[class*='atvwebplayersdk-skipelement-button' i]",
      ],
    },
    "skip-recap": {
      selectors: ["button[class*='skipelement' i]"],
    },
    "skip-credits": {
      selectors: ["button[class*='skipelement' i]"],
    },
    "next-episode": {
      selectors: [
        ".atvwebplayersdk-playnextbutton",
        ".atvwebplayersdk-nextepisodebutton",
        "button[class*='playnextbutton' i]",
        "button[class*='nextepisodebutton' i]",
      ],
    },
  });

  Object.assign(root.WatchDashAdapterActions ||= {}, { primeVideoActions, disneyActions, appleTvActions });
})(globalThis);
