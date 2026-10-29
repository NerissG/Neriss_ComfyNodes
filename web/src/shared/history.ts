/**
 * Undo history for an immutable document. `key` identifies the persisted document content, so
 * view-only changes such as selection replace the present entry instead of adding an undo step.
 */
export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  group: string | null;
};

const limit = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], group: null };
}

export function restoreHistory<T>(history: History<T> | undefined, present: T, key: (value: T) => string): History<T> {
  if (!history || key(history.present) !== key(present)) return createHistory(present);
  return { ...history, present, group: null };
}

/** Records one undo step per call, or one per run of calls sharing a group such as a paint stroke. */
export function recordHistory<T>(
  history: History<T>,
  next: T,
  key: (value: T) => string,
  group: string | null = null,
): History<T> {
  if (key(history.present) === key(next)) return { ...history, present: next };
  return {
    past:
      group !== null && group === history.group ? history.past : [...history.past.slice(1 - limit), history.present],
    present: next,
    future: [],
    group,
  };
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  return previous
    ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], group: null }
    : history;
}

export function redoHistory<T>(history: History<T>): History<T> {
  const next = history.future[0];
  return next
    ? { past: [...history.past, history.present], present: next, future: history.future.slice(1), group: null }
    : history;
}
