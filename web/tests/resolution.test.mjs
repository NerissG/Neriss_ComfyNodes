import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { URL } from "node:url";
import { createServer } from "vite";
import { ResultAsync, errAsync, okAsync } from "neverthrow";
import { get } from "svelte/store";

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
after(() => server.close());
const { createPresetLibrary, presetLibrary } = await server.ssrLoadModule("/src/resolution/library.ts");
const { connectResolutionSelector } = await server.ssrLoadModule("/src/resolution/selector.ts");
const { calculateResolution } = await server.ssrLoadModule("/src/resolution/sizing.ts");
const { saveResolutionPresets } = await server.ssrLoadModule("/src/resolution/presets.ts");
const { comfyErrors } = await server.ssrLoadModule("/src/errors.ts");
const original = [{ name: "Square", x: 1, y: 1 }];
const edited = [{ name: "Portrait", x: 3, y: 5 }];

test("concurrent consumers share one load and reuse the saved library", async () => {
  let loads = 0;
  const library = createPresetLibrary(
    () => {
      loads += 1;
      return okAsync(original);
    },
    (presets) => okAsync(presets),
  );
  const first = library.ensureLoaded();
  assert.equal(library.ensureLoaded(), first);
  assert.equal(get(library).loading, true);
  await first;
  assert.deepEqual((await library.ensureLoaded())._unsafeUnwrap(), original);
  assert.equal(loads, 1);
  await library.save(edited);
  assert.deepEqual(get(library).presets, edited);
});

test("load failures retry and save failures leave the published library intact", async () => {
  const failure = comfyErrors.runtime("Unavailable");
  let failing = true;
  const library = createPresetLibrary(
    () => (failing ? errAsync(failure) : okAsync(original)),
    () => errAsync(failure),
  );
  assert.equal((await library.ensureLoaded()).isErr(), true);
  assert.equal(get(library).error, failure);
  failing = false;
  await library.reload();
  assert.equal(get(library).error, null);
  assert.equal((await library.save(edited)).isErr(), true);
  assert.deepEqual(get(library).presets, original);
});

test("a stale GET cannot overwrite a successfully saved library", async () => {
  const response = Promise.withResolvers();
  const library = createPresetLibrary(
    () => ResultAsync.fromSafePromise(response.promise),
    (presets) => okAsync(presets),
  );
  const pending = library.reload();
  await library.save(edited);
  response.resolve(original);
  assert.deepEqual((await pending)._unsafeUnwrap(), edited);
  assert.deepEqual(get(library).presets, edited);
});

test("conflicts invalidate the cached library without discarding its last published presets", async () => {
  let loads = 0;
  const conflict = comfyErrors.runtime("Reload before saving", { status: 409 });
  const library = createPresetLibrary(
    () => okAsync(++loads === 1 ? original : edited),
    () => errAsync(conflict),
  );
  await library.ensureLoaded();
  assert.equal((await library.save(original)).isErr(), true);
  assert.deepEqual(get(library).presets, original);
  assert.equal(get(library).loaded, false);
  assert.equal(get(library).error, conflict);
  assert.deepEqual((await library.ensureLoaded())._unsafeUnwrap(), edited);
  assert.equal(loads, 2);
});

test("an old GET cannot undo a conflict or clear a newer recovery request", async () => {
  const stale = Promise.withResolvers();
  const recovery = Promise.withResolvers();
  let loads = 0;
  const library = createPresetLibrary(
    () => ResultAsync.fromSafePromise(++loads === 1 ? stale.promise : recovery.promise),
    () => errAsync(comfyErrors.runtime("Conflict", { status: 409 })),
  );
  const first = library.reload();
  await library.save(original);
  const second = library.ensureLoaded();
  stale.resolve(original);
  await first;
  assert.equal(get(library).loaded, false);
  assert.equal(get(library).loading, true);
  assert.equal(library.ensureLoaded(), second);
  recovery.resolve(edited);
  assert.deepEqual((await second)._unsafeUnwrap(), edited);
  assert.equal(get(library).loading, false);
});

test("selector subscriptions update every node, preserve snapshots, and detach on removal", async () => {
  const fetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return globalThis.Response.json({ presets: original });
  };
  const restoreFetch = () => {
    globalThis.fetch = fetch;
  };
  try {
    await presetLibrary.reload();
    const createNode = (id) => ({
      id,
      widgets: [
        { name: "preset", value: "Square" },
        { name: "preset_aspect_x", value: 1 },
        { name: "preset_aspect_y", value: 1 },
      ],
      addWidget: () => {},
    });
    const first = createNode(1);
    const second = createNode(2);
    connectResolutionSelector(first);
    connectResolutionSelector(first);
    connectResolutionSelector(second);
    globalThis.fetch = async (_url, init) => globalThis.Response.json(JSON.parse(init.body));
    await presetLibrary.save(edited);
    for (const node of [first, second]) {
      assert.deepEqual(node.widgets[0].options.values, ["Square", "Portrait"]);
      assert.equal(node.widgets[1].value, 1);
    }
    second.widgets[0].value = "Portrait";
    second.widgets[0].callback("Portrait");
    assert.equal(second.widgets[1].value, 3);
    assert.equal(second.widgets[2].value, 5);
    assert.equal(requests, 1);
    first.onRemoved();
    await presetLibrary.save([{ name: "Wide", x: 7, y: 2 }]);
    assert.deepEqual(first.widgets[0].options.values, ["Square", "Portrait"]);
    assert.deepEqual(second.widgets[0].options.values, ["Portrait", "Wide"]);
    second.onRemoved();
  } finally {
    restoreFetch();
  }
});

test("preset names are checked for duplicates after trimming", async () => {
  const result = await saveResolutionPresets([
    { name: "Square", x: 1, y: 1 },
    { name: " Square ", x: 2, y: 2 },
  ]);
  assert.equal(result.isErr(), true);
  assert.match(result.error.message, /Duplicate/);
});

test("a preset dropdown retains a shared workflow's missing label and saved ratio", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    globalThis.Response.json({ presets: [{ name: "Local square", x: 1, y: 1 }] }),
  );
  await presetLibrary.reload();
  const node = {
    id: "shared-workflow",
    widgets: [
      { name: "preset", type: "combo", value: "Someone else's portrait" },
      { name: "preset_aspect_x", value: 9 },
      { name: "preset_aspect_y", value: 16 },
    ],
    addWidget: () => {},
  };
  connectResolutionSelector(node);
  context.after(() => node.onRemoved());
  assert.equal(node.widgets[0].type, "combo");
  assert.deepEqual(node.widgets[0].options.values, ["Someone else's portrait", "Local square"]);
  assert.equal(node.widgets[1].value, 9);
  assert.equal(node.widgets[2].value, 16);
  node.widgets[0].callback("Local square");
  assert.equal(node.widgets[1].value, 1);
  assert.equal(node.widgets[2].value, 1);
});

test("a new selector initializes its label and numeric snapshot from the first frontend preset", async (context) => {
  context.mock.method(globalThis, "fetch", async () => globalThis.Response.json({ presets: edited }));
  await presetLibrary.reload();
  const node = {
    id: "new-selector",
    widgets: [
      { name: "preset", type: "combo", value: "" },
      { name: "preset_aspect_x", value: 1 },
      { name: "preset_aspect_y", value: 1 },
    ],
    addWidget: () => {},
  };
  connectResolutionSelector(node);
  context.after(() => node.onRemoved());
  assert.equal(node.widgets[0].value, "Portrait");
  assert.equal(node.widgets[1].value, 3);
  assert.equal(node.widgets[2].value, 5);
});

test("frontend sizing matches the shared Python cases", async () => {
  const cases = JSON.parse(
    await readFile(new URL("../../tests/fixtures/resolution_sizing.json", import.meta.url), "utf8"),
  );
  for (const { aspect_x, aspect_y, target_pixels, multiple, width, height } of cases) {
    assert.deepEqual(calculateResolution(aspect_x, aspect_y, target_pixels, multiple), { width, height });
  }
});
