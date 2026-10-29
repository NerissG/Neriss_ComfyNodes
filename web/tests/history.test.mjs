import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
after(() => server.close());
const { createInitialState, layoutDocumentKey: key } = await server.ssrLoadModule("/src/layout/state.ts");
const { createHistory, recordHistory, restoreHistory, undoHistory, redoHistory } =
  await server.ssrLoadModule("/src/shared/history.ts");

test("restoring a layout retains undo and redo while ending the previous edit group", () => {
  const original = createInitialState();
  const edited = { ...original, high_level_description: "First edit" };
  const history = recordHistory(createHistory(original), edited, key, "field-1");
  const reopened = restoreHistory(history, globalThis.structuredClone(edited), key);
  assert.equal(reopened.group, null);
  assert.deepEqual(undoHistory(reopened).present, original);

  const undone = undoHistory(reopened);
  const restoredUndo = restoreHistory(undone, globalThis.structuredClone(original), key);
  assert.deepEqual(redoHistory(restoredUndo).present, edited);
  const next = { ...edited, high_level_description: "Second edit" };
  assert.equal(recordHistory(reopened, next, key, "field-1").past.length, 2);
});

test("restoring uses the current selection without discarding document history", () => {
  const original = createInitialState();
  const edited = { ...original, high_level_description: "Edited" };
  const history = recordHistory(createHistory(original), edited, key);
  const selected = { ...edited, selected_tool: "text" };
  const reopened = restoreHistory(history, selected, key);
  assert.deepEqual(reopened.present, selected);
  assert.deepEqual(reopened.past, [original]);
});

test("missing history or an externally replaced layout starts a fresh history", () => {
  const original = createInitialState();
  const edited = { ...original, high_level_description: "Edited" };
  const history = undoHistory(recordHistory(createHistory(original), edited, key));
  const replacement = { ...original, width: 2048 };
  assert.deepEqual(restoreHistory(undefined, original, key), createHistory(original));
  assert.deepEqual(restoreHistory(history, replacement, key), createHistory(replacement));
});
