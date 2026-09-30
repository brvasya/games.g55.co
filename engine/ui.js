export function renderGameTitle(element, title) {
  const text = String(title ?? "").trim();
  const colon = text.indexOf(":");
  const prefix = colon > 0 && colon < text.length - 1 ? text.slice(0, colon + 1) : "";
  const name = prefix ? text.slice(colon + 1).trim() : text;
  if (element.children.length === (prefix ? 2 : 1) &&
      (element.querySelector(".main-title-prefix")?.textContent || "") === prefix &&
      element.querySelector(".main-title-name")?.textContent === name) return;
  element.replaceChildren();
  const add = (className, value) => {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = value;
    element.appendChild(span);
  };
  if (colon > 0 && colon < text.length - 1) {
    add("main-title-prefix", text.slice(0, colon + 1));
    add("main-title-name", text.slice(colon + 1).trim());
  } else add("main-title-name", text);
}

export function controlsText(touch) {
  return touch
    ? "Left stick move · Swipe right side to aim · Hold + drag Fire · Tap weapon to switch"
    : "WASD move · Shift walk · Space jump · Mouse aim · LMB fire · RMB scope / toggle light · R reload · 1–6 / wheel weapons · B shop · Esc pause · F fullscreen";
}

export function focusControl(element) {
  element?.focus({ preventScroll: true });
}

export function clearMenuSelection() {
  document.body.classList.remove("keyboard-navigation");
}

export function focusMenu(container) {
  clearMenuSelection();
  container.tabIndex = -1;
  focusControl(container);
}

export function trapDialogFocus(container, event) {
  if (event.code !== "Tab") return;
  if (container.inert) { event.preventDefault(); return; }
  document.body.classList.add("keyboard-navigation");
  const items = [...container.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')]
    .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
  if (!items.length) { event.preventDefault(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  if (!items.includes(document.activeElement)) {
    event.preventDefault();
    focusControl(event.shiftKey ? last : first);
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    focusControl(last);
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    focusControl(first);
  }
}
