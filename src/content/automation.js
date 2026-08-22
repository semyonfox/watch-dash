(function registerWatchDashAutomation(root) {
  const clickableSelector =
    "button, a, [role='button'], input[type='button'], input[type='submit']";

  function findActionTarget(action, options) {
    const selectorRoots = getSelectorRoots(options && options.selectorRoots);

    for (const selector of action.selectors || []) {
      for (const root of selectorRoots) {
        const matches = queryElements(
          selector,
          root,
          options && options.queryCache,
        );
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
    const candidates =
      Array.isArray(roots) && roots.length > 0 ? roots : [document];
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

    return (
      elements.find((element) => {
        const target = resolveClickableElement(element);

        if (!target) {
          return false;
        }

        const label = normalizeText(
          [
            target.getAttribute("aria-label"),
            target.getAttribute("data-uia"),
            target.getAttribute("data-testid"),
            target.getAttribute("data-test-id"),
            target.getAttribute("data-automation-id"),
            target.getAttribute("title"),
            target.value,
            target.textContent,
          ]
            .filter(Boolean)
            .join(" "),
        );

        return wanted.some((text) => label.includes(text));
      }) || null
    );
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

    const parent =
      element && typeof element.closest === "function"
        ? element.closest(
            "button, a, [role='button'], input[type='button'], input[type='submit']",
          )
        : null;

    return isClickable(parent) ? parent : null;
  }

  function findClickableChild(element) {
    if (!element || typeof element.querySelectorAll !== "function") {
      return null;
    }

    return (
      Array.from(element.querySelectorAll(clickableSelector)).find(
        isClickable,
      ) || null
    );
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isClickable(element) {
    if (
      !element ||
      element.disabled ||
      element.getAttribute("aria-disabled") === "true"
    ) {
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

    let rect;
    try {
      rect = element.getBoundingClientRect();
    } catch (error) {
      return false;
    }

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    let style;
    try {
      style = getComputedStyle(element);
    } catch (error) {
      return false;
    }

    const styledVisible =
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || "1") > 0.01;

    if (!styledVisible) {
      return false;
    }

    if (!isWithinViewport(rect)) {
      return false;
    }

    return !isCoveredByOverlay(element, rect);
  }

  function isWithinViewport(rect) {
    const width =
      typeof window === "undefined" ? NaN : Number(window.innerWidth);
    const height =
      typeof window === "undefined" ? NaN : Number(window.innerHeight);

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return true;
    }

    const left = Number(rect.left);
    const top = Number(rect.top);

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return true;
    }

    const right = Number.isFinite(Number(rect.right))
      ? Number(rect.right)
      : left + rect.width;
    const bottom = Number.isFinite(Number(rect.bottom))
      ? Number(rect.bottom)
      : top + rect.height;

    // Fully off-screen controls cannot be seen or reached by a user.
    return right > 0 && bottom > 0 && left < width && top < height;
  }

  function isCoveredByOverlay(element, rect) {
    const doc = element.ownerDocument;

    if (!doc || typeof doc.elementFromPoint !== "function") {
      return false;
    }

    const width =
      typeof window === "undefined" ? NaN : Number(window.innerWidth);
    const height =
      typeof window === "undefined" ? NaN : Number(window.innerHeight);
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;

    x = clampToRange(x, Number.isFinite(width) ? width - 1 : x);
    y = clampToRange(y, Number.isFinite(height) ? height - 1 : y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }

    let hit;

    try {
      hit = doc.elementFromPoint(x, y);
    } catch (error) {
      return false;
    }

    return Boolean(hit) && !isSameHitRegion(element, hit);
  }

  function clampToRange(value, max) {
    return Math.min(Math.max(value, 0), max);
  }

  function isSameHitRegion(element, hit) {
    if (hit === element) {
      return true;
    }

    if (typeof element.contains === "function" && element.contains(hit)) {
      return true;
    }

    if (typeof hit.contains === "function" && hit.contains(element)) {
      return true;
    }

    // Shadow trees retarget hit testing to the shadow host.
    const nodeRoot =
      typeof element.getRootNode === "function" ? element.getRootNode() : null;

    return Boolean(nodeRoot && nodeRoot.host && nodeRoot.host === hit);
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
    element.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    element.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    element.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    element.click();
  }

  function dispatchPointerEvent(element, type) {
    if (typeof PointerEvent !== "function") {
      return;
    }

    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        view: window,
      }),
    );
  }

  root.WatchDashAutomation = Object.freeze({
    findActionTarget,
    clickElement,
    isVisibleElement,
    queryElements,
    normalizeText,
  });
})(globalThis);
