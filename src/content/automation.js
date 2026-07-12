(function registerWatchDashAutomation(root) {
  const clickableSelector = "button, a, [role='button'], input[type='button'], input[type='submit']";

  function findActionTarget(action, options) {
    const selectorRoots = getSelectorRoots(options && options.selectorRoots);

    for (const selector of action.selectors || []) {
      for (const root of selectorRoots) {
        const matches = queryElements(selector, root, options && options.queryCache);
        const target = matches.map(resolveClickableElement).find(Boolean);

        if (target) {
          return target;
        }
      }
    }

    if (options && options.allowTextFallback === false) {
      return null;
    }

    return findByText(action.text || [], options && options.textFallbackRoot);
  }

  function getSelectorRoots(roots) {
    const candidates = Array.isArray(roots) && roots.length > 0 ? roots : [document];
    const seen = new Set();
    const uniqueRoots = [];

    for (const root of candidates.concat(document)) {
      if (!root || seen.has(root)) {
        continue;
      }

      seen.add(root);
      uniqueRoots.push(root);
    }

    return uniqueRoots;
  }

  function findByText(labels, scopeRoot) {
    if (labels.length === 0 || scopeRoot === null) {
      return null;
    }

    const wanted = labels.map(normalizeText);
    const elements = queryElements(clickableSelector, scopeRoot || document);

    return elements.find((element) => {
      const target = resolveClickableElement(element);

      if (!target) {
        return false;
      }

      const label = normalizeText([
        target.getAttribute("aria-label"),
        target.getAttribute("data-uia"),
        target.getAttribute("data-testid"),
        target.getAttribute("data-test-id"),
        target.getAttribute("data-automation-id"),
        target.getAttribute("title"),
        target.value,
        target.textContent
      ].filter(Boolean).join(" "));

      return wanted.some((text) => label.includes(text));
    }) || null;
  }

  function queryElements(selector, root, cache) {
    const scope = root || document;

    if (!scope || typeof scope.querySelectorAll !== "function") {
      return [];
    }

    if (cache) {
      let rootCache = cache.get(scope);

      if (!rootCache) {
        rootCache = new Map();
        cache.set(scope, rootCache);
      }

      if (rootCache.has(selector)) {
        return rootCache.get(selector);
      }

      const results = queryElementsUncached(selector, scope);
      rootCache.set(selector, results);
      return results;
    }

    return queryElementsUncached(selector, scope);
  }

  function queryElementsUncached(selector, scope) {
    try {
      return Array.from(scope.querySelectorAll(selector));
    } catch (error) {
      return [];
    }
  }

  function resolveClickableElement(element) {
    if (isClickable(element)) {
      return element;
    }

    const child = findClickableChild(element);
    if (child) {
      return child;
    }

    const parent = element && typeof element.closest === "function" ?
      element.closest("button, a, [role='button'], input[type='button'], input[type='submit']") :
      null;

    return isClickable(parent) ? parent : null;
  }

  function findClickableChild(element) {
    if (!element || typeof element.querySelectorAll !== "function") {
      return null;
    }

    return Array.from(element.querySelectorAll(clickableSelector))
      .find(isClickable) || null;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isClickable(element) {
    if (!element || element.disabled || element.getAttribute("aria-disabled") === "true") {
      return false;
    }

    return isVisibleElement(element);
  }

  function isVisibleElement(element) {
    if (typeof element.checkVisibility === "function") {
      try {
        if (!element.checkVisibility()) {
          return false;
        }
      } catch (error) {
        // Some pages patch DOM APIs. Fall through to the explicit checks.
      }
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || "1") > 0.01;
  }

  function clickElement(element) {
    try {
      element.focus({ preventScroll: true });
    } catch (error) {
      // Focus is a best-effort hint for player controls.
    }

    dispatchPointerEvent(element, "pointerover");
    dispatchPointerEvent(element, "pointerdown");
    dispatchPointerEvent(element, "pointerup");
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    element.click();
  }

  function dispatchPointerEvent(element, type) {
    if (typeof PointerEvent !== "function") {
      return;
    }

    element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      view: window
    }));
  }

  root.WatchDashAutomation = Object.freeze({
    findActionTarget,
    clickElement,
    queryElements,
    normalizeText
  });
})(globalThis);
