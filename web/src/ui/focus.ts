const focusable = 'button, input, select, textarea, summary, [tabindex="0"]';

/** Keeps Tab navigation cycling inside `scope`; `root` is the container that may hold focus itself. */
export function trapTab(event: KeyboardEvent, scope: HTMLElement, root: HTMLElement = scope) {
  const controls = Array.from(scope.querySelectorAll<HTMLElement>(focusable)).filter(
    (item) => item.getClientRects().length > 0 && !item.matches(":disabled"),
  );
  const first = controls[0];
  const last = controls.at(-1);
  const active = document.activeElement;
  const outside = !scope.contains(active) || active === root;
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first?.focus();
  }
}

export function restoreFocus(element: Element | null) {
  if (element instanceof HTMLElement && element.isConnected) element.focus({ preventScroll: true });
}
