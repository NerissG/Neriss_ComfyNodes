import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
after(() => server.close());
const { applyPreset, capturePreset, createInitialState, createRegion } =
  await server.ssrLoadModule("/src/layout/state.ts");
const { presetSummary } = await server.ssrLoadModule("/src/layout/models.ts");
const { layoutPresetPayloadSchema } = await server.ssrLoadModule("/src/layout/api.ts");

function layout() {
  const card = { ...createRegion("obj", [0, 0, 500, 500]), label: "character", desc: "Fox girl" };
  const title = { ...createRegion("text", null), parent_id: card.id, text: "Neriss" };
  return {
    ...createInitialState(),
    high_level_description: "Poster",
    moss_meta: ["flat colors"],
    elements: [card, title],
    selected_region_id: card.id,
  };
}

test("capturing keeps only the chosen parts and detaches them from the editor state", () => {
  const state = layout();
  const parts = capturePreset(state, ["elements", "moss_meta"]);
  assert.deepEqual(Object.keys(parts), ["elements", "moss_meta"]);
  assert.deepEqual(parts.elements, state.elements);
  parts.moss_meta.push("edited");
  assert.deepEqual(state.moss_meta, ["flat colors"]);
  assert.equal(layoutPresetPayloadSchema.safeParse({ presets: [{ id: "a", name: "A", parts }] }).success, true);
  assert.equal(layoutPresetPayloadSchema.safeParse({ presets: [{ id: "a", name: "A", parts: {} }] }).success, false);
});

test("applying only touches the chosen parts and renews region IDs with their hierarchy", () => {
  const source = layout();
  const parts = capturePreset(source, ["elements", "high_level_description", "moss_meta"]);
  const target = { ...createInitialState(), high_level_description: "Keep", elements: [createRegion("obj")] };
  const replaced = applyPreset(target, parts, ["elements"], "replace")._unsafeUnwrap();
  assert.equal(replaced.high_level_description, "Keep");
  assert.equal(replaced.selected_region_id, null);
  const [card, title] = replaced.elements;
  assert.notEqual(card.id, source.elements[0].id);
  assert.equal(title.parent_id, card.id);
  assert.equal(card.label, "character");

  const appended = applyPreset(target, parts, ["elements", "moss_meta"], "append")._unsafeUnwrap();
  assert.equal(appended.elements.length, 3);
  assert.equal(appended.elements[0], target.elements[0]);
  assert.deepEqual(appended.moss_meta, ["flat colors"]);
  const twice = applyPreset(appended, parts, ["elements"], "append")._unsafeUnwrap();
  assert.equal(new Set(twice.elements.map((region) => region.id)).size, 5);
});

test("the canvas part restores size settings without moving canvas-relative regions", () => {
  const source = { ...layout(), width: 832, height: 1216, side_step: 32, size_mode: "squared", target_locked: true };
  const parts = capturePreset(source, ["elements", "canvas"]);
  assert.deepEqual(parts.canvas, {
    width: 832,
    height: 1216,
    megapixels: 1,
    side_step: 32,
    size_mode: "squared",
    target_locked: true,
  });
  const target = { ...createInitialState(), width: 1536, height: 640 };
  const itemsOnly = applyPreset(target, parts, ["elements"], "replace")._unsafeUnwrap();
  assert.deepEqual([itemsOnly.width, itemsOnly.height], [1536, 640]);
  assert.deepEqual(
    itemsOnly.elements.map((region) => region.bbox),
    source.elements.map((region) => region.bbox),
  );
  const both = applyPreset(target, parts, ["elements", "canvas"], "replace")._unsafeUnwrap();
  assert.deepEqual([both.width, both.height, both.side_step, both.size_mode], [832, 1216, 32, "squared"]);
  assert.equal(presetSummary("moss", parts), "Items 2 · Canvas 832×1216");
});

test("appending past the region limit fails instead of truncating", () => {
  const parts = { elements: Array.from({ length: 2048 }, () => createRegion("obj")) };
  const result = applyPreset(
    { ...createInitialState(), elements: [createRegion("obj")] },
    parts,
    ["elements"],
    "append",
  );
  assert.equal(result.isErr(), true);
});

test("summaries name each editor's parts and mark parts only the other editor uses", () => {
  const parts = {
    ...capturePreset(layout(), ["elements", "moss_meta"]),
    style_description: createInitialState().style_description,
  };
  assert.equal(presetSummary("moss", parts), "Items 2 · Meta 1 · Style (Ideogram 4 only)");
  assert.equal(presetSummary("ideogram", parts), "Regions 2 · Style · Meta 1 (MOSS only)");
});
