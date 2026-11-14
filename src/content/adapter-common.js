(function registerAdapterCommon(root) {
  function action(config) {
    const actionConfig = Object.assign(
      {
        cooldownMs: 0,
        selectors: [],
        text: [],
      },
      config,
    );

    return Object.assign({}, actionConfig, {
      selectors: uniqueList(actionConfig.selectors),
      text: uniqueList(actionConfig.text),
    });
  }

  function extendAction(base, extension) {
    return action(
      Object.assign({}, base, extension || {}, {
        selectors: [].concat(
          extension && extension.selectors ? extension.selectors : [],
          base.selectors || [],
        ),
        text: [].concat(
          extension && extension.text ? extension.text : [],
          base.text || [],
        ),
      }),
    );
  }

  function uniqueList(values) {
    const seen = new Set();
    const items = [];

    for (const value of values || []) {
      if (seen.has(value)) {
        continue;
      }

      seen.add(value);
      items.push(value);
    }

    return items;
  }

  const commonContinuePlaying = action({
    id: "continue-playing",
    setting: "continuePlaying",
    label: "Continue playing",
    controlLabel: "Continue",
    selectors: [
      "button[aria-label*='Continue Playing' i]",
      "button[aria-label*='Continue Watching' i]",
      "button[aria-label*='Keep Watching' i]",
      "button[aria-label*='Resume' i]",
      "[role='button'][aria-label*='Continue Playing' i]",
      "[role='button'][aria-label*='Continue Watching' i]",
      "[role='button'][aria-label*='Keep Watching' i]",
      "[role='button'][aria-label*='Resume' i]",
      "button[title*='Continue Watching' i]",
      "button[data-testid*='continue' i]",
      "button[data-test-id*='continue' i]",
      "button[data-automation-id*='continue' i]",
      "[data-testid*='continue-playing' i]",
      "button[class*='continue' i]",
      "button[class*='resume' i]",
    ],
    text: ["Continue Playing", "Continue Watching", "Keep Watching", "Resume"],
  });

  const commonSkipIntro = action({
    id: "skip-intro",
    setting: "skipIntros",
    label: "Skip intro",
    controlLabel: "Intros",
    selectors: [
      "button[aria-label*='Skip Intro' i]",
      "[role='button'][aria-label*='Skip Intro' i]",
      "button[title*='Skip Intro' i]",
      "[role='button'][title*='Skip Intro' i]",
      "button[data-testid*='skip-intro' i]",
      "button[data-testid*='skipintro' i]",
      "button[data-test-id*='skip-intro' i]",
      "button[data-automation-id*='skip-intro' i]",
      "[data-testid*='skip-intro' i]",
      "button[class*='skip-intro' i]",
      "button[class*='skipIntro' i]",
      "[class*='skip-intro' i]",
      "[class*='skipIntro' i]",
    ],
    text: ["Skip Intro"],
  });

  const commonSkipRecap = action({
    id: "skip-recap",
    setting: "skipRecaps",
    label: "Skip recap",
    controlLabel: "Recaps",
    selectors: [
      "button[aria-label*='Skip Recap' i]",
      "[role='button'][aria-label*='Skip Recap' i]",
      "button[title*='Skip Recap' i]",
      "[role='button'][title*='Skip Recap' i]",
      "button[data-testid*='skip-recap' i]",
      "button[data-testid*='skiprecap' i]",
      "button[data-test-id*='skip-recap' i]",
      "button[data-automation-id*='skip-recap' i]",
      "[data-testid*='skip-recap' i]",
      "button[class*='skip-recap' i]",
      "button[class*='skipRecap' i]",
      "[class*='skip-recap' i]",
      "[class*='skipRecap' i]",
    ],
    text: ["Skip Recap"],
  });

  const commonSkipCredits = action({
    id: "skip-credits",
    setting: "skipCredits",
    label: "Skip credits",
    controlLabel: "Credits",
    selectors: [
      "button[aria-label*='Skip Credits' i]",
      "button[aria-label*='Skip Credit' i]",
      "[role='button'][aria-label*='Skip Credits' i]",
      "[role='button'][aria-label*='Skip Credit' i]",
      "button[aria-label*='Skip Ending' i]",
      "[role='button'][aria-label*='Skip Ending' i]",
      "button[title*='Skip Credits' i]",
      "button[data-testid*='skip-credits' i]",
      "button[data-testid*='skipcredits' i]",
      "button[data-test-id*='skip-credits' i]",
      "button[data-automation-id*='skip-credits' i]",
      "[data-testid*='skip-credits' i]",
      "button[class*='skip-credits' i]",
      "button[class*='skipCredits' i]",
      "[class*='skip-credits' i]",
      "[class*='skipCredits' i]",
    ],
    text: ["Skip Credits", "Skip Credit", "Skip Ending"],
  });

  const commonNextEpisode = action({
    id: "next-episode",
    setting: "autoNextEpisode",
    type: "nextEpisode",
    label: "Next episode",
    controlLabel: "Next Episode",
    cooldownMs: 90000,
    selectors: [
      "button[aria-label*='Next Episode' i]",
      "button[aria-label*='Play Next Episode' i]",
      "button[aria-label*='Play Next' i]",
      "button[aria-label*='Up Next' i]",
      "[role='button'][aria-label*='Next Episode' i]",
      "[role='button'][aria-label*='Play Next Episode' i]",
      "[role='button'][aria-label*='Play Next' i]",
      "[role='button'][aria-label*='Up Next' i]",
      "button[title*='Next Episode' i]",
      "button[data-testid*='next-episode' i]",
      "button[data-testid*='nextepisode' i]",
      "button[data-test-id*='next-episode' i]",
      "button[data-automation-id*='next-episode' i]",
      "[data-testid*='next-episode' i]",
      "button[class*='next-episode' i]",
      "button[class*='nextEpisode' i]",
      "[class*='next-episode' i]",
      "[class*='nextEpisode' i]",
      "button[class*='nextup' i]",
      "[class*='nextup' i] button",
    ],
    text: ["Next Episode", "Play Next Episode", "Play Next", "Up Next"],
  });

  const commonActions = [
    commonContinuePlaying,
    commonSkipIntro,
    commonSkipRecap,
    commonSkipCredits,
    commonNextEpisode,
  ];

  function platform(config) {
    return Object.assign(
      {
        actions: commonActions,
        allowVideoSurfaceFallback: false,
      },
      config,
    );
  }

  function withTestIdSelectors(actions) {
    return actions.map((item) =>
      extendAction(item, {
        selectors: [
          `button[data-testid*='${item.id}' i]`,
          `[data-testid*='${item.id}' i]`,
        ],
      }),
    );
  }

  root.WatchDashAdapterCommon = Object.freeze({ action, extendAction, platform, withTestIdSelectors, commonActions, commonContinuePlaying, commonSkipIntro, commonSkipRecap, commonSkipCredits, commonNextEpisode });
})(globalThis);
