(function registerWatchDashAutomation(root) {
  function findActionTarget(action, options) {
    for (const selector of action.selectors || []) {
      const matches = queryElements(selector);
      const target = matches.map(resolveClickableElement).find(Boolean);

      if (target) {
        return target;
      }
    }

    if (options && options.allowTextFallback === false) {
      return null;
    }

    return findByText(action.text || []);
  }

  function findByText(labels) {
    if (labels.length === 0) {
      return null;
    }

    const wanted = labels.map(normalizeText);
    const elements = queryElements("button, a, [role='button'], input[type='button'], input[type='submit']");

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

  function queryElements(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
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

    return Array.from(element.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit']"))
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
