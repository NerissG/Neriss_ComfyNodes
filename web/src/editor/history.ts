import type { EditorState } from "./state";

export type EditorHistory = {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
  group: string | null;
};

export function createHistory(present: EditorState): EditorHistory {
  return { past: [], present, future: [], group: null };
}

function documentKey(state: EditorState): string {
  return JSON.stringify({ ...state, selected_region_id: null, selected_tool: "obj" });
}

export function restoreHistory(history: EditorHistory | undefined, present: EditorState): EditorHistory {
  if (!history || documentKey(history.present) !== documentKey(present)) return createHistory(present);
  return { ...history, present, group: null };
}

export function recordHistory(history: EditorHistory, next: EditorState, group: string | null = null): EditorHistory {
  if (documentKey(history.present) === documentKey(next)) return { ...history, present: next };
  return {
    past: group !== null && group === history.group ? history.past : [...history.past.slice(-99), history.present],
    present: next,
    future: [],
    group,
  };
}

export function undoHistory(history: EditorHistory): EditorHistory {
  const previous = history.past.at(-1);
  return previous
    ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], group: null }
    : history;
}

export function redoHistory(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  return next
    ? { past: [...history.past, history.present], present: next, future: history.future.slice(1), group: null }
    : history;
}
