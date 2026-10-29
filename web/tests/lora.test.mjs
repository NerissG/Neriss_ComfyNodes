import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
after(() => server.close());
const { targetGroups, targetMultiplier, parseStrengthState } = await server.ssrLoadModule("/src/lora/state.ts");
const {
  buildBlockFamilies,
  blockChanged,
  filterBlockFamilies,
  setBlockMultipliers,
  clearOverrides,
  hasOverridesWithin,
  familyTargets,
  familyModules,
  weightChanges,
  formatWeights,
  parseWeights,
  chartRange,
  hasClipTargets,
} = await server.ssrLoadModule("/src/lora/blocks.ts");
const { comfyUrl } = await server.ssrLoadModule("/src/comfy/api.ts");
const { loraChoices, prepareLoraChoices, filterLoraChoices } = await server.ssrLoadModule("/src/lora/picker.ts");

test("LoRA search matches filename and folder terms in any order, ignoring case and separators", () => {
  const choices = prepareLoraChoices([
    "Anima/Style/gpt-image-2_anima_v1.safetensors",
    "Anima\\Char\\Sugaya-Nowa_anima-p3_v1.safetensors",
    "root.safetensors",
  ]);
  assert.equal(choices[0].label, "gpt-image-2_anima_v1");
  assert.equal(choices[0].folder, "Anima/Style");
  assert.equal(choices[1].folder, "Anima/Char");
  assert.equal(choices[2].folder, "");
  assert.equal(filterLoraChoices(choices, "GPT style ANIMA")[0].name, choices[0].name);
  assert.equal(filterLoraChoices(choices, "char\\sugaya nowa")[0].name, choices[1].name);
  assert.deepEqual(filterLoraChoices(choices, "not found"), []);
  assert.equal(filterLoraChoices(choices, "   "), choices);
});

test("LoRA selector uses the node's choices without dropping a missing current selection", () => {
  const widget = {
    name: "lora_name",
    value: "folder/current.safetensors",
    options: { values: ["other.safetensors", "other.safetensors"] },
  };
  assert.deepEqual(loraChoices({ widgets: [widget] }), ["folder/current.safetensors", "other.safetensors"]);
  assert.deepEqual(loraChoices({ widgets: [{ name: "lora_name", value: "current.safetensors" }] }), [
    "current.safetensors",
  ]);
  assert.deepEqual(
    loraChoices({ widgets: [{ name: "lora_name", value: "current.safetensors", options: { values: "invalid" } }] }),
    ["current.safetensors"],
  );
  assert.deepEqual(loraChoices({ widgets: [] }), []);
});

test("fallback Comfy URLs preserve encoded query parameters", () => {
  assert.equal(
    comfyUrl("/neriss_comfynodes/lora/targets?lora_name=folder%2Fa%20b.safetensors"),
    "/neriss_comfynodes/lora/targets?lora_name=folder%2Fa%20b.safetensors",
  );
});

test("group discovery preserves names and respects numeric boundaries", () => {
  assert.deepEqual(targetGroups("diffusion_model.blocks.10.attn.to_q"), [
    "diffusion_model",
    "diffusion_model.blocks",
    "diffusion_model.blocks.10",
    "diffusion_model.blocks.10.attn",
  ]);
  assert.deepEqual(targetGroups("lora_unet_input_blocks_10_1_attn_to_q"), [
    "lora_unet_input_blocks_10",
    "lora_unet_input_blocks_10_1",
  ]);
});

test("most specific overrides replace parents, including zero and negative multipliers", () => {
  const overrides = { blocks: 0.5, "blocks.1": 0, "blocks.1.q": -1 };
  assert.equal(targetMultiplier("blocks.1.q", overrides), -1);
  assert.equal(targetMultiplier("blocks.1.k", overrides), 0);
  assert.equal(targetMultiplier("blocks.10.k", overrides), 0.5);
  assert.equal(targetMultiplier("other.1.q", overrides), 1);
  assert.equal(targetMultiplier("toString", {}), 1);
});

test("families discover dotted and underscore blocks without architecture tables", () => {
  const families = buildBlockFamilies([
    "lora_unet_blocks_10_attn_q",
    "lora_unet_blocks_2_attn_q",
    "lora_unet_blocks_2_attn_k",
    "lora_unet_llm_adapter_blocks_0_proj",
    "new_arch.layers.3.attn.q",
    "embedding.proj",
  ]);
  const blocks = families.find((family) => family.name === "lora_unet_blocks");
  assert.equal(blocks.label, "Blocks");
  assert.deepEqual(
    blocks.blocks.map((block) => block.label),
    ["Block 02", "Block 10"],
  );
  assert.deepEqual(
    blocks.blocks.map((block) => block.short),
    ["02", "10"],
  );
  assert.equal(blocks.blocks[0].targets.length, 2);
  assert.deepEqual(
    blocks.blocks[0].controls.map((control) => control.label),
    ["attn_k", "attn_q"],
  );
  assert.equal(families.find((family) => family.name === "lora_unet_llm_adapter_blocks").label, "LLM adapter");
  assert.equal(families.find((family) => family.name === "new_arch.layers").blocks[0].name, "new_arch.layers.3");
  assert.equal(families.at(-1).label, "Other");
  assert.equal(families.at(-1).blocks[0].name, "embedding.proj");
});

test("nested numeric paths stay inside their outer block and raw rule names are unchanged", () => {
  const [family] = buildBlockFamilies(["lora_unet_input_blocks_0_1_attn_to_q", "lora_unet_input_blocks_0_1_attn_to_k"]);
  assert.equal(family.blocks.length, 1);
  assert.equal(family.blocks[0].name, "lora_unet_input_blocks_0");
  assert.deepEqual(
    family.blocks[0].controls.map((control) => [control.name, control.group]),
    [
      ["lora_unet_input_blocks_0_1", true],
      ["lora_unet_input_blocks_0_1_attn_to_k", false],
      ["lora_unet_input_blocks_0_1_attn_to_q", false],
    ],
  );
});

test("search finds blocks by module, readable family and block labels", () => {
  const families = buildBlockFamilies([
    "diffusion_model.blocks.0.attn.q",
    "diffusion_model.blocks.10.mlp.fc1",
    "lora_unet_llm_adapter_blocks_0_q",
  ]);
  assert.equal(filterBlockFamilies(families, "BLOCK 10", false, {})[0].blocks[0].name, "diffusion_model.blocks.10");
  assert.equal(filterBlockFamilies(families, "fc1", false, {})[0].blocks[0].name, "diffusion_model.blocks.10");
  assert.equal(filterBlockFamilies(families, "llm adapter", false, {})[0].name, "lora_unet_llm_adapter_blocks");
  assert.deepEqual(filterBlockFamilies(families, "not present", false, {}), []);
});

test("changed filter includes module overrides, explicit defaults and inherited changes", () => {
  const families = buildBlockFamilies(["blocks.0.attn.q", "blocks.1.attn.q"]);
  const [first, second] = families[0].blocks;
  assert.equal(blockChanged(first, {}), false);
  assert.equal(blockChanged(first, { "blocks.0.attn.q": 0 }), true);
  assert.equal(blockChanged(first, { "blocks.0": 1 }), true);
  assert.equal(blockChanged(second, { blocks: -1 }), true);
  assert.equal(filterBlockFamilies(families, "", true, { "blocks.0.attn.q": 0 })[0].blocks.length, 1);
});

test("bulk edits keep module overrides; clearing names removes nested rules and leaves unrelated ones", () => {
  const original = { blocks: 0.9, "blocks.0.attn.q": 0.2, "blocks.1": 0.8, "blocks.10": 0.5 };
  const edited = setBlockMultipliers(original, ["blocks.0"], 0);
  assert.equal(edited["blocks.0"], 0);
  assert.equal(edited["blocks.0.attn.q"], 0.2);
  assert.equal(original["blocks.0"], undefined);
  assert.deepEqual(clearOverrides(edited, ["blocks.0"]), { blocks: 0.9, "blocks.1": 0.8, "blocks.10": 0.5 });
  assert.deepEqual(clearOverrides(edited, ["blocks.0.attn.q"]), {
    blocks: 0.9,
    "blocks.0": 0,
    "blocks.1": 0.8,
    "blocks.10": 0.5,
  });
  const underscore = { lora_unet_blocks_1_attn_to_q: 0, lora_unet_blocks_10_attn_to_q: 0.5 };
  assert.deepEqual(clearOverrides(underscore, ["lora_unet_blocks_1"]), { lora_unet_blocks_10_attn_to_q: 0.5 });
  assert.equal(hasOverridesWithin(underscore, ["lora_unet_blocks_1"]), true);
  assert.equal(hasOverridesWithin(underscore, ["lora_unet_blocks_2"]), false);
});

test("module lenses chart one module across blocks and skip blocks without it", () => {
  const [family] = buildBlockFamilies([
    "lora_unet_blocks_0_attn_wq",
    "lora_unet_blocks_0_mlp_fc1",
    "lora_unet_blocks_1_attn_wq",
    "lora_unet_blocks_2_mlp_fc1",
  ]);
  assert.deepEqual(familyModules(family), [
    { label: "attn_wq", count: 2 },
    { label: "mlp_fc1", count: 2 },
  ]);
  assert.deepEqual(
    familyTargets(family, "").map((target) => target.name),
    ["lora_unet_blocks_0", "lora_unet_blocks_1", "lora_unet_blocks_2"],
  );
  assert.deepEqual(
    familyTargets(family, "attn_wq").map((target) => [target.block.short, target.name]),
    [
      ["00", "lora_unet_blocks_0_attn_wq"],
      ["01", "lora_unet_blocks_1_attn_wq"],
    ],
  );
});

test("saved strength state rejects malformed, future and invalid numeric values", () => {
  for (const value of [
    "{broken",
    '{"version":2}',
    JSON.stringify({ version: 1, lora_name: "a", overrides: { q: 21 } }),
    JSON.stringify({ version: 1, lora_name: "a", overrides: { q: true } }),
    " ".repeat(2 * 1024 * 1024 + 1),
  ]) {
    assert.equal(parseStrengthState(value).isErr(), true);
  }
  assert.equal(parseStrengthState('{"version":1,"lora_name":"a","overrides":{"q":0}}').isOk(), true);
});

test("weight vectors round-trip, only override names that change and reject bad lengths or values", () => {
  const names = ["blocks.0", "blocks.1", "blocks.2"];
  const overrides = { blocks: 0.5, "blocks.2": 1 };
  assert.equal(formatWeights(names.map((name) => targetMultiplier(name, overrides))), "0.5,0.5,1");
  assert.deepEqual(parseWeights(" 0.5, 0 ;1.25 ", 3)._unsafeUnwrap(), [0.5, 0, 1.25]);
  assert.deepEqual(parseWeights("1 0 -1", 3)._unsafeUnwrap(), [1, 0, -1]);
  for (const text of ["1,1", "1,1,1,1", "1,x,1", "1,21,1", ""]) assert.equal(parseWeights(text, 3).isErr(), true);
  assert.deepEqual(weightChanges(names, overrides, [0.5, 0, 1]), { "blocks.1": 0 });
});

test("chart range keeps 0 to 2 visible and grows for outliers", () => {
  assert.deepEqual(chartRange([1, 0.5]), { lo: 0, hi: 2 });
  assert.deepEqual(chartRange([-1, 3]), { lo: -1, hi: 3 });
});

test("text encoder targets are detected from Comfy's CLIP LoRA key prefixes", () => {
  assert.equal(hasClipTargets(["lora_te1_text_model_encoder_layers_0_mlp_fc1"]), true);
  assert.equal(hasClipTargets(["lora_te_text_model_encoder_layers_0_mlp_fc1"]), true);
  assert.equal(hasClipTargets(["text_encoders.t5xxl.encoder.block.0.q"]), true);
  assert.equal(hasClipTargets(["lora_unet_llm_adapter_blocks_0_q", "diffusion_model.blocks.0.q"]), false);
});
