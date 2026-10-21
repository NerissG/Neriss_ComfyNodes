import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

// Use Vite's real TS/alias resolution without adding a second transpiler.
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
after(() => server.close());
const { createInitialState, parseEditorState, stringifyEditorState, setAspectRatio } =
  await server.ssrLoadModule("/src/editor/state.ts");
const { buildMossPrompt: buildMossPromptResult, importMossText } = await server.ssrLoadModule("/src/moss/prompt.ts");
const buildMossPrompt = (state) => buildMossPromptResult(state)._unsafeUnwrap();
const { buildPrompt, importIdeogramText } = await server.ssrLoadModule("/src/ideogram/prompt.ts");
const { moveRegion, regionOutline, removeRegions } = await server.ssrLoadModule("/src/editor/regions.ts");
const { toCentralized, fromCentralized, moveBbox, resizeBbox, bboxFromPoints } =
  await server.ssrLoadModule("/src/editor/geometry.ts");
const { parseColor } = await server.ssrLoadModule("/src/editor/colors.ts");
const sample = JSON.parse(await readFile(new URL("../../tests/fixtures/moss_layout.json", import.meta.url), "utf8"));

test("palette colors parse pasted hex and RGB values", () => {
  for (const text of ["#a6493f", " A6493F ", "166, 73, 63", "166 73 63", "rgb(166, 73, 63)", "RGB( 166,73,63 )"]) {
    assert.equal(parseColor(text), "#A6493F", text);
  }
  assert.equal(parseColor("#abc"), "#AABBCC");
  for (const text of ["256, 0, 0", "166, 73", "rgb(1, 2, 3, 4)", "16673 63", "#abcd", "red"]) {
    assert.equal(parseColor(text), null, text);
  }
});

test("MOSS example imports and exports exactly, including text and negative coordinates", () => {
  const result = importMossText(createInitialState(), JSON.stringify(sample));
  assert.equal(result.isOk(), true);
  assert.deepEqual(buildMossPrompt(result.value), sample);
});

test("MOSS element palettes survive import, editing, saved state, and export", async () => {
  const prompt = JSON.parse(
    await readFile(new URL("../../tests/fixtures/moss_palette_layout.json", import.meta.url), "utf8"),
  );
  const imported = importMossText(createInitialState(), JSON.stringify(prompt));
  assert.equal(imported.isOk(), true);
  assert.deepEqual(imported.value.elements[0].color_palette, ["#FFFFFF"]);
  assert.deepEqual(buildMossPrompt(imported.value), {
    ...prompt,
    summary: { ...prompt.summary, meta: [], canvas: "single" },
  });
  imported.value.elements[0].color_palette = ["#123ABC", "#000000"];
  const saved = parseEditorState(stringifyEditorState(imported.value));
  assert.equal(saved.isOk(), true);
  const exported = buildMossPrompt(saved.value);
  assert.deepEqual(exported.items[0].palette, ["#123ABC", "#000000"]);
  const reimported = importMossText(createInitialState(), JSON.stringify(exported));
  assert.equal(reimported.isOk(), true);
  assert.deepEqual(buildMossPrompt(reimported.value), exported);
  saved.value.elements[0].color_palette = [];
  assert.equal("palette" in buildMossPrompt(saved.value).items[0], false);
});

test("MOSS non-text types retain literal text in saved state without exporting it", () => {
  const imported = importMossText(createInitialState(), JSON.stringify(sample));
  assert.equal(imported.isOk(), true);
  const original = imported.value.elements.find((region) => region.type === "text");
  assert.ok(original);
  for (const label of ["object", "character", "custom subject"]) {
    const switched = {
      ...imported.value,
      elements: [{ ...original, type: "obj", label, color_palette: ["#FFFFFF"] }],
    };
    const saved = parseEditorState(stringifyEditorState(switched));
    assert.equal(saved.isOk(), true);
    assert.equal(saved.value.elements[0].text, original.text);
    const item = buildMossPrompt(saved.value).items[0];
    assert.equal(item.label, label);
    assert.equal("text" in item, false);
    saved.value.elements[0] = { ...saved.value.elements[0], type: "text", label: "text" };
    const restored = buildMossPrompt(saved.value).items[0];
    assert.equal(restored.text, original.text);
    assert.equal(restored.caption, original.desc);
    assert.deepEqual(restored.palette, ["#FFFFFF"]);
    assert.deepEqual(restored.bbox, toCentralized(original.bbox, switched.width, switched.height));
  }
});

test("MOSS rejects invalid and oversized palettes", () => {
  for (const palette of ["#FFFFFF", ["red"], ["#12345G"], Array(6).fill("#FFFFFF")]) {
    const prompt = { ...sample, items: [{ ...sample.items[0], palette }] };
    const result = importMossText(createInitialState(), JSON.stringify(prompt));
    assert.equal(result.isErr(), true);
    assert.match(result.error.message, /items.0.palette/);
  }
});

test("caption-only summary and character labels survive import and saved state", async () => {
  const prompt = JSON.parse(
    await readFile(new URL("../../tests/fixtures/moss_character_layout.json", import.meta.url), "utf8"),
  );
  const expected = { ...prompt, summary: { ...prompt.summary, meta: [], canvas: "single" } };
  for (const [width, height] of [
    [1088, 1344],
    [12000, 16000],
  ]) {
    const result = importMossText({ ...createInitialState(), width, height }, JSON.stringify(prompt));
    assert.equal(result.isOk(), true);
    const saved = parseEditorState(stringifyEditorState(result.value));
    assert.equal(saved.isOk(), true);
    assert.equal(saved.value.elements[0].label, "character");
    assert.deepEqual(buildMossPrompt(saved.value), expected);
  }
});

test("drawing, movement, and resizing always stay inside the image", () => {
  assert.deepEqual(bboxFromPoints({ x: -200, y: -100 }, { x: 1200, y: 1100 }), [0, 0, 1000, 1000]);
  assert.deepEqual(moveBbox([100, 200, 400, 600], -2000, -2000), [0, 0, 300, 400]);
  assert.deepEqual(moveBbox([100, 200, 400, 600], 2000, 2000), [700, 600, 1000, 1000]);
  assert.deepEqual(resizeBbox([100, 200, 400, 600], "nw", -2000, -2000), [0, 0, 400, 600]);
  assert.deepEqual(resizeBbox([100, 200, 400, 600], "se", 2000, 2000), [100, 200, 1000, 1000]);
});

test("both prompt formats clip imported elements instead of placing them outside the image", () => {
  const state = createInitialState();
  const moss = { ...sample, items: [{ label: "character", caption: "Cat", bbox: [-800, -900, 800, 900] }] };
  const mossResult = importMossText(state, JSON.stringify(moss));
  assert.equal(mossResult.isOk(), true);
  assert.deepEqual(buildMossPrompt(mossResult.value).items[0].bbox, [-512, -512, 512, 512]);
  const ideogram = buildPrompt({
    ...state,
    elements: [{ id: "cat", type: "obj", bbox: [-100, -200, 1100, 1200], desc: "Cat", text: "", color_palette: [] }],
  });
  const ideogramResult = importIdeogramText(state, JSON.stringify(ideogram), "all");
  assert.equal(ideogramResult.isOk(), true);
  assert.deepEqual(buildPrompt(ideogramResult.value).compositional_deconstruction.elements[0].bbox, [0, 0, 1000, 1000]);
});

test("canvas sides and megapixels have no fixed cap, while saved elements remain contained", () => {
  const large = parseEditorState(
    JSON.stringify({
      width: 20000,
      height: 15000,
      megapixels: 300,
      side_step: 2048,
      elements: [{ id: "cat", type: "obj", bbox: [-100, -200, 1100, 1200] }],
    }),
  );
  assert.equal(large.isOk(), true);
  assert.equal(large.value.width, 20000);
  assert.equal(large.value.height, 15000);
  assert.deepEqual(large.value.elements[0].bbox, [0, 0, 1000, 1000]);
  const tiny = parseEditorState(JSON.stringify({ width: 1, height: 3 }));
  assert.equal(tiny.isOk(), true);
  const resized = setAspectRatio({ ...createInitialState(), megapixels: 100, side_step: 1 }, 2, 1);
  assert.deepEqual([resized.width, resized.height], [14142, 7071]);
});

test("centered boxes use the correct axis dimensions on rectangular and odd canvases", () => {
  for (const [width, height] of [
    [1536, 768],
    [768, 1536],
    [1025, 769],
  ]) {
    assert.deepEqual(toCentralized([0, 0, 1000, 1000], width, height), [
      -height / 2,
      -width / 2,
      height / 2,
      width / 2,
    ]);
    const box = [-height / 2 + 3, -width / 2 + 1, height / 2 - 7, width / 2 - 5];
    assert.deepEqual(toCentralized(fromCentralized(box, width, height), width, height), box);
  }
});

test("large-canvas single-pixel coordinates survive repeated JSON round trips", () => {
  let state = { ...createInitialState(), width: 8192, height: 4096 };
  const expected = {
    ...sample,
    items: [{ label: "object", caption: "One-pixel precision", bbox: [-2045, -4095, -2022, -4078] }],
  };
  for (let index = 0; index < 10; index++) {
    const result = importMossText(state, JSON.stringify(expected));
    assert.equal(result.isOk(), true);
    state = result.value;
    assert.deepEqual(buildMossPrompt(state), expected);
  }
});

test("invalid coordinates and prompts for another format are rejected", () => {
  const state = createInitialState();
  assert.equal(importMossText(state, "{").isErr(), true);
  assert.equal(importMossText(state, JSON.stringify({ ...sample, bbox_format: "xyxy" })).isErr(), true);
  const inverted = { ...sample, items: [{ label: "object", caption: "bad", bbox: [100, 0, -100, 20] }] };
  assert.equal(importMossText(state, JSON.stringify(inverted)).isErr(), true);
  assert.equal(importMossText(state, JSON.stringify(buildPrompt(state))).isErr(), true);
  const missingText = { ...sample, items: [{ label: "text", caption: "Title", bbox: [-100, -100, 100, 100] }] };
  const result = importMossText(state, JSON.stringify(missingText));
  assert.equal(result.isErr(), true);
  assert.match(result.error.message, /items.0.text/);
});

test("Ideogram retains its schema, style, palettes, and literal text", () => {
  const state = {
    ...createInitialState(),
    high_level_description: "A poster",
    elements: [
      {
        id: "title",
        type: "text",
        bbox: [100, 200, 300, 800],
        desc: "Blue title",
        text: "探索 🌄",
        color_palette: ["#123ABC"],
      },
    ],
  };
  const prompt = buildPrompt(state);
  assert.deepEqual(prompt.compositional_deconstruction.elements[0], {
    type: "text",
    bbox: [100, 200, 300, 800],
    desc: "Blue title",
    text: "探索 🌄",
    color_palette: ["#123ABC"],
  });
  assert.equal("summary" in prompt, false);
  const result = importIdeogramText(createInitialState(), JSON.stringify(prompt), "all");
  assert.equal(result.isOk(), true);
  assert.deepEqual(buildPrompt(result.value), prompt);
});

function nestedState() {
  const region = (id, parent_id, bbox, type = "obj") => ({
    id,
    parent_id,
    bbox,
    type,
    desc: id,
    text: type === "text" ? "Hello" : "",
    color_palette: ["#123ABC"],
  });
  return {
    ...createInitialState(),
    selected_region_id: "detail",
    elements: [
      region("detail", "child", [300, 400, 500, 600], "text"),
      region("parent", null, [100, 100, 200, 200]),
      region("other", null, [0, 0, 1000, 1000]),
      region("child", "parent", [250, 350, 550, 650]),
    ],
  };
}

test("nested workflows compile parent-first into both native formats without changing fields or boxes", () => {
  const saved = parseEditorState(stringifyEditorState(nestedState()))._unsafeUnwrap();
  assert.equal(saved.elements[0].parent_id, "child");
  assert.deepEqual(
    regionOutline(saved.elements).map(({ depth }) => depth),
    [0, 1, 2, 0],
  );
  const flat = {
    ...saved,
    elements: regionOutline(saved.elements).map(({ region }) => {
      const native = { ...region };
      delete native.parent_id;
      return native;
    }),
  };
  assert.deepEqual(buildPrompt(saved), buildPrompt(flat));
  assert.deepEqual(buildMossPrompt(saved), buildMossPrompt(flat));
  assert.deepEqual(
    buildPrompt(saved).compositional_deconstruction.elements.map((item) => item.desc),
    ["parent", "child", "detail", "other"],
  );
  assert.equal(JSON.stringify(buildPrompt(saved)).includes("parent_id"), false);
  assert.equal(JSON.stringify(buildMossPrompt(saved)).includes("parent_id"), false);
});

test("moving subtrees preserves descendants, sibling order, selection and absolute boxes", () => {
  const state = nestedState();
  const moved = moveRegion(state, "child", "other", 0);
  assert.deepEqual(
    moved.elements.map((region) => region.id),
    ["parent", "other", "child", "detail"],
  );
  assert.equal(moved.elements[2].parent_id, "other");
  assert.equal(moved.elements[3].parent_id, "child");
  assert.deepEqual(moved.elements[2].bbox, state.elements[3].bbox);
  assert.equal(moved.selected_region_id, "detail");
  assert.equal(moveRegion(state, "parent", "detail", 0), state);
  assert.equal(moveRegion(state, "parent", "parent", 0), state);
  assert.equal(moveRegion(state, "parent", "missing", 0), state);
  const root = moveRegion(moved, "child", null, 0);
  assert.deepEqual(
    root.elements.map((region) => region.id),
    ["child", "detail", "parent", "other"],
  );
  const reordered = moveRegion(root, "child", null, 3);
  assert.deepEqual(
    reordered.elements.map((region) => region.id),
    ["parent", "other", "child", "detail"],
  );
  const removed = removeRegions(reordered, ["child", "detail"]);
  assert.deepEqual(
    removed.elements.map((region) => region.id),
    ["parent", "other"],
  );
  assert.equal(removed.selected_region_id, null);
});

test("saved hierarchy rejects missing parents, duplicate IDs and cycles", () => {
  for (const [id, parent_id] of [
    ["parent", "detail"],
    ["parent", "parent"],
    ["child", "missing"],
  ]) {
    const state = nestedState();
    state.elements = state.elements.map((region) => (region.id === id ? { ...region, parent_id } : region));
    assert.equal(parseEditorState(JSON.stringify(state)).isErr(), true);
  }
  const state = nestedState();
  state.elements.push({ ...state.elements[0] });
  assert.equal(parseEditorState(JSON.stringify(state)).isErr(), true);
});

test("unplaced children persist without invented boxes and export according to each native format", () => {
  const state = nestedState();
  state.elements[0].bbox = null;
  const saved = parseEditorState(stringifyEditorState(state))._unsafeUnwrap();
  assert.equal(saved.elements[0].bbox, null);
  assert.equal(saved.elements[0].parent_id, "child");
  const prompt = buildPrompt(saved);
  const detail = prompt.compositional_deconstruction.elements[2];
  assert.equal("bbox" in detail, false);
  assert.equal(detail.text, "Hello");
  assert.equal(detail.desc, "detail");
  assert.deepEqual(detail.color_palette, ["#123ABC"]);
  const imported = importIdeogramText(createInitialState(), JSON.stringify(prompt), "all")._unsafeUnwrap();
  assert.equal(imported.elements[2].bbox, null);
  assert.deepEqual(buildPrompt(imported), prompt);
  const moss = buildMossPromptResult(saved);
  assert.equal(moss.isErr(), true);
  assert.match(moss.error.message, /Draw a bounding box.*Hello/);
  saved.elements[0].bbox = [300, 400, 500, 600];
  assert.equal(buildMossPromptResult(saved).isOk(), true);
});
