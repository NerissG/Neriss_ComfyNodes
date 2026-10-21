import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { URL } from "node:url";
import { createServer } from "vite";
import { ResultAsync, errAsync, okAsync } from "neverthrow";
import { get } from "svelte/store";

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
after(() => server.close());
const { defaultUiSettings, uiSettingsSchema } = await server.ssrLoadModule("/src/settings/schema.ts");
const {
  shortcutCommands,
  matchShortcut,
  shortcutIssues,
  bindingFromEvent,
  formatBinding,
  shortcutLabel,
  isShortcutKey,
} = await server.ssrLoadModule("/src/settings/shortcuts.ts");
const { createUiSettingsStore } = await server.ssrLoadModule("/src/settings/store.ts");
const { editorErrors } = await server.ssrLoadModule("/src/errors.ts");
const cases = JSON.parse(await readFile(new URL("../../tests/fixtures/ui_settings.json", import.meta.url), "utf8"));

const binding = (key, ...modifiers) => ({ key, modifiers });
const event = (key, fields = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  isComposing: false,
  repeat: false,
  getModifierState: () => false,
  ...fields,
});
const match = (key, fields = {}, overrides = {}, scope = "editor", model = "moss", mac = false) =>
  matchShortcut(event(key, fields), overrides, scope, model, mac);

test("frontend and backend share the documented defaults and validation cases", () => {
  assert.deepEqual(
    Object.fromEntries(shortcutCommands.map((command) => [command.id, command.defaults])),
    cases.defaultBindings,
  );
  for (const value of cases.valid) assert.equal(uiSettingsSchema.safeParse(value).success, true, JSON.stringify(value));
  for (const value of cases.invalid)
    assert.equal(uiSettingsSchema.safeParse(value).success, false, JSON.stringify(value));
  assert.deepEqual(uiSettingsSchema.parse({ version: 1 }), defaultUiSettings());
  for (const key of "abcdefghijklmnopqrstuvwxyz0123456789`~!@#$%^&*()_+-=[]{}\\|;:'\",.<>/?")
    assert.equal(isShortcutKey(key), true, key);
  for (const key of ["é", "ä", "∫", "ß", "😀"]) assert.equal(isShortcutKey(key), true, key);
});

test("defaults, overrides, disabled commands, aliases and exact modifiers", () => {
  assert.equal(match("V"), "tool.select");
  assert.equal(match("v", { shiftKey: true }), null);
  assert.equal(match("v", {}, { "tool.select": [] }), null);
  assert.equal(match("b", {}, { "tool.select": [binding("b")] }), "tool.select");
  assert.equal(match("v", {}, { "tool.select": [binding("b")] }), null);
  assert.equal(match("z", { ctrlKey: true }), "history.undo");
  assert.equal(match("z", { ctrlKey: true, shiftKey: true }), "history.redo");
  assert.equal(match("y", { ctrlKey: true }), "history.redo");
  assert.equal(match("y", { ctrlKey: true, altKey: true }), null);
  assert.equal(match("z", { metaKey: true }, {}, "editor", "moss", true), "history.undo");
  assert.equal(match("z", { ctrlKey: true }, {}, "editor", "moss", true), null);
  assert.equal(match("1", { altKey: true }), "panel.regions");
  assert.equal(match("1", { altKey: true, shiftKey: true }), null);
  assert.equal(match("Delete"), "selection.delete");
  assert.equal(match("Backspace"), "selection.delete");
});

test("scope, model, composition, dead keys, AltGraph and repetition", () => {
  assert.equal(match("c", {}, {}, "editor", "ideogram"), null);
  assert.equal(match("c"), "tool.character");
  assert.equal(match("ArrowLeft"), null);
  assert.equal(match("ArrowLeft", {}, {}, "canvas"), "canvas.left");
  assert.equal(match("ArrowLeft", { shiftKey: true, repeat: true }, {}, "canvas"), "canvas.leftFast");
  for (const fields of [
    { defaultPrevented: true },
    { isComposing: true },
    { repeat: true },
    { getModifierState: () => true },
  ]) {
    assert.equal(match("v", fields), null);
  }
  assert.equal(match("Dead"), null);
  assert.equal(match("Process"), null);
  assert.equal(match("Escape"), null);
});

test("conflicts include canvas/editor overlap and both platform modifier expansions", () => {
  assert.deepEqual(shortcutIssues({}), []);
  assert.match(shortcutIssues({ "tool.select": [binding("arrowleft")] }).join(" "), /Move left/);
  for (const modifier of ["Control", "Meta"]) {
    assert.ok(shortcutIssues({ "tool.select": [binding("b", "Mod")], "tool.object": [binding("b", modifier)] }).length);
  }
  assert.deepEqual(shortcutIssues({ "tool.select": [binding("o")], "tool.object": [] }), []);
});

test("recorded platform modifiers and displayed / accessible labels match", () => {
  assert.deepEqual(
    bindingFromEvent(event("B", { ctrlKey: true, shiftKey: true }), false),
    binding("b", "Mod", "Shift"),
  );
  assert.deepEqual(bindingFromEvent(event("b", { metaKey: true }), true), binding("b", "Mod"));
  assert.equal(formatBinding(binding("z", "Mod", "Shift"), false), "Ctrl+Shift+Z");
  assert.equal(formatBinding(binding("z", "Mod", "Shift"), true), "Cmd+Shift+Z");
  assert.equal(formatBinding(binding("arrowleft", "Shift"), false, true), "Shift+ArrowLeft");
  assert.equal(shortcutLabel("tool.select", { "tool.select": [] }), "");
});

test("settings store shares loads and serializes patches against the latest saved snapshot", async () => {
  let resolveLoad;
  const loaded = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  let loads = 0;
  let inFlight = 0;
  const writes = [];
  const store = createUiSettingsStore(
    () => {
      loads++;
      return ResultAsync.fromSafePromise(loaded);
    },
    (settings) => {
      assert.equal(inFlight++, 0);
      writes.push(uiSettingsSchema.parse(settings));
      return ResultAsync.fromSafePromise(
        Promise.resolve(settings).then((value) => {
          inFlight--;
          return value;
        }),
      );
    },
  );
  const first = store.ensureLoaded();
  const second = store.ensureLoaded();
  assert.equal(loads, 1);
  const width = store.saveEditor({ sidebarWidth: 520 });
  const shortcuts = store.saveEditor({ shortcuts: { "tool.select": [binding("b")] } });
  resolveLoad(defaultUiSettings());
  assert.equal((await first).isOk(), true);
  assert.equal((await second).isOk(), true);
  await width;
  await shortcuts;
  assert.equal(writes.length, 2);
  assert.equal(writes[1].editor.sidebarWidth, 520);
  assert.deepEqual(writes[1].editor.shortcuts, { "tool.select": [binding("b")] });
  assert.deepEqual(get(store).settings, writes[1]);
});

test("load failure prevents all writes, keeps defaults and supports retry", async () => {
  let fail = true;
  let writes = 0;
  const store = createUiSettingsStore(
    () => (fail ? errAsync(editorErrors.runtime("Unreadable file")) : okAsync(defaultUiSettings())),
    (value) => {
      writes++;
      return okAsync(value);
    },
  );
  assert.equal((await store.saveEditor({ sidebarWidth: 500 })).isErr(), true);
  assert.equal(writes, 0);
  assert.equal(get(store).loaded, false);
  assert.deepEqual(get(store).settings, defaultUiSettings());
  fail = false;
  assert.equal((await store.retry()).isOk(), true);
  assert.equal(get(store).error, null);
});

test("invalid loaded settings are never used or saved", async () => {
  const store = createUiSettingsStore(
    () => okAsync({ version: 2 }),
    () => {
      assert.fail("Must not save");
    },
  );
  assert.equal((await store.saveEditor({ sidebarWidth: 500 })).isErr(), true);
  assert.equal(get(store).loaded, false);
});

test("failed saves are visible, retried in order and do not erase unrelated patches", async () => {
  let fail = true;
  const store = createUiSettingsStore(
    () => okAsync(defaultUiSettings()),
    (value) => (fail ? errAsync(editorErrors.runtime("Disk full")) : okAsync(value)),
  );
  assert.equal((await store.saveEditor({ sidebarWidth: 520 })).isErr(), true);
  assert.equal(get(store).settings.editor.sidebarWidth, 390);
  assert.match(get(store).error.message, /Disk full/);
  fail = false;
  await store.saveEditor({ shortcuts: { "tool.select": [binding("b")] } });
  assert.equal(get(store).settings.editor.sidebarWidth, 520);
  fail = true;
  await store.saveEditor({ shortcuts: { "tool.select": [binding("g")] } });
  fail = false;
  await store.retry();
  assert.deepEqual(get(store).settings.editor.shortcuts, { "tool.select": [binding("g")] });
});

test("cancelling a failed shortcut draft prevents a later sidebar save from applying it", async () => {
  let fail = true;
  const store = createUiSettingsStore(
    () => okAsync(defaultUiSettings()),
    (value) => (fail ? errAsync(editorErrors.runtime("Disk full")) : okAsync(value)),
  );
  await store.saveEditor({ shortcuts: { "tool.select": [binding("b")] } });
  store.discardShortcutDraft();
  fail = false;
  await store.saveEditor({ sidebarWidth: 500 });
  assert.deepEqual(get(store).settings.editor.shortcuts, {});
  assert.equal(get(store).error, null);
});
