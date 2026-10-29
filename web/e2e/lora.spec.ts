import { expect, type Locator } from "@playwright/test";
import { test } from "./fixtures";

const endpoint = "**/neriss_comfynodes/lora/targets?*";
const targets = [
  "diffusion_model.blocks.0.attn.q",
  "diffusion_model.blocks.0.attn.k",
  "diffusion_model.blocks.10.attn.q",
];
const block0 = "diffusion_model.blocks.0";
const block10 = "diffusion_model.blocks.10";

async function setNumber(control: Locator, value: string) {
  await control.fill(value);
  await control.press("Tab");
}

function bar(modal: Locator, name: string) {
  return modal.getByRole("slider", { name: `Multiplier ${name}`, exact: true });
}

async function setBlock(modal: Locator, name: string, value: string) {
  await bar(modal, name).click();
  await setNumber(modal.getByRole("spinbutton", { name: `Multiplier ${name}`, exact: true }), value);
}

async function selectLora(modal: Locator, name: string) {
  const picker = modal.getByRole("combobox", { name: "LoRA", exact: true });
  await picker.click();
  await picker.fill(name);
  await modal.getByRole("option", { name, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/neriss_comfynodes/resolution/presets", (route) =>
    route.fulfill({ json: { presets: [{ name: "Square", x: 1, y: 1 }] } }),
  );
  await page.route(endpoint, (route) => {
    const name = new URL(route.request().url()).searchParams.get("lora_name");
    return route.fulfill({ json: { lora_name: name, targets, unsupported: [] } });
  });
});

test("large LoRA libraries filter by folder and filename and select with the keyboard", async ({ page }, testInfo) => {
  await page.goto("/preview/index.html?lora=1&loraLibrary=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  const picker = modal.getByRole("combobox", { name: "LoRA", exact: true });
  await expect(modal.getByRole("button", { name: "Apply strengths" })).toBeEnabled();
  await picker.click();
  await picker.fill("ANIMA style gpt");
  const name = "Anima/Style/gpt-image-2_anima_v1.safetensors";
  await expect(modal.getByRole("listbox", { name: "LoRAs", exact: true }).getByRole("option")).toHaveCount(1);
  await expect(modal.getByRole("option", { name, exact: true })).toContainText("Anima/Style");
  await modal.screenshot({ path: testInfo.outputPath("lora-searchable-picker.png") });
  await picker.press("ArrowDown");
  await picker.press("Enter");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await expect(picker).toHaveValue("Anima/Style/gpt-image-2_anima_v1");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Apply strengths" }).click();
  await expect(page.getByRole("combobox", { name: "Preview LoRA", exact: true })).toHaveValue(name);
});

test("LoRA picker virtualizes large lists, handles empty results and dismisses without changing selection", async ({
  page,
}) => {
  await page.goto("/preview/index.html?lora=1&loraLibrary=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  const picker = modal.getByRole("combobox", { name: "LoRA", exact: true });
  await expect(modal.getByRole("button", { name: "Apply strengths" })).toBeEnabled();
  await picker.click();
  expect(await modal.getByRole("listbox", { name: "LoRAs", exact: true }).getByRole("option").count()).toBeLessThan(24);
  await picker.press("End");
  const active = await picker.getAttribute("aria-activedescendant");
  expect(active).not.toBeNull();
  if (active) await expect(modal.locator(`[id="${active}"]`)).toBeVisible();
  await modal.getByRole("listbox", { name: "LoRAs", exact: true }).evaluate((element) => (element.scrollTop = 0));
  await expect(modal.getByRole("option", { name: "demo.safetensors", exact: true })).toBeVisible();
  await expect(picker).not.toHaveAttribute("aria-activedescendant", /.+/);
  await picker.fill("nothing_matches_this_name");
  await expect(modal.getByRole("listbox", { name: "LoRAs", exact: true }).getByRole("option")).toHaveCount(0);
  await expect(modal.getByText("No matching LoRAs", { exact: true })).toBeVisible();
  await picker.press("Enter");
  await expect(modal).toBeVisible();
  await picker.press("Escape");
  await expect(picker).toHaveValue("demo");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await expect(modal).toBeVisible();
  await picker.click();
  await modal.getByRole("button", { name: "Toggle LoRA list", exact: true }).click();
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await picker.click();
  await modal.getByRole("button", { name: "Changed", exact: true }).click();
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await expect(picker).toHaveValue("demo");
});

test("searchable LoRA popup stays inside a mobile viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/preview/index.html?lora=1&loraLibrary=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  const picker = modal.getByRole("combobox", { name: "LoRA", exact: true });
  await picker.click();
  await picker.fill("anima");
  await expect(modal.getByRole("listbox", { name: "LoRAs", exact: true }).getByRole("option")).toHaveCount(2);
  const popup = modal.locator(".picker-popup");
  const bounds = await popup.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  if (bounds) expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await popup.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await modal.screenshot({ path: testInfo.outputPath("lora-searchable-picker-mobile.png") });
  await picker.press("Escape");
  await expect(modal).toBeVisible();
  await picker.press("Escape");
  await expect(modal).toHaveCount(0);
});

test("header LoRA dropdown loads targets, keeps per-file drafts and commits the node selection only on apply", async ({
  page,
}) => {
  await page.route(endpoint, (route) => {
    const name = new URL(route.request().url()).searchParams.get("lora_name");
    return route.fulfill({
      json: {
        lora_name: name,
        targets: name === "other.safetensors" ? ["transformer.layers.7.q"] : targets,
        unsupported: [],
      },
    });
  });
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  const selector = modal.getByRole("combobox", { name: "LoRA", exact: true });
  await expect(selector).toHaveValue("demo");
  await expect(modal.getByText("LoRA strengths", { exact: true })).toHaveCount(0);
  await setBlock(modal, block0, "0.5");
  await selectLora(modal, "other.safetensors");
  const other = bar(modal, "transformer.layers.7");
  await expect(other).toHaveAttribute("aria-valuenow", "1");
  await expect(bar(modal, block0)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Preview LoRA", exact: true })).toHaveValue("demo.safetensors");
  await setBlock(modal, "transformer.layers.7", "0.8");
  await selectLora(modal, "demo.safetensors");
  await expect(bar(modal, block0)).toHaveAttribute("aria-valuenow", "0.5");
  await selectLora(modal, "other.safetensors");
  await expect(other).toHaveAttribute("aria-valuenow", "0.8");
  await modal.getByRole("button", { name: "Apply strengths" }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Preview LoRA", exact: true })).toHaveValue("other.safetensors");
  await expect(page.getByTestId("lora-state")).toContainText('"lora_name":"other.safetensors"');
  await expect(page.getByTestId("lora-state")).toContainText('"transformer.layers.7":0.8');
  await expect(page.getByTestId("lora-state")).not.toContainText(block0);
});

test("cancelling a header LoRA selection leaves the node and its saved strengths unchanged", async ({ page }) => {
  const saved = JSON.stringify({ version: 1, lora_name: "demo.safetensors", overrides: { [block0]: 0.5 } });
  await page.goto(`/preview/index.html?lora=1&loraState=${encodeURIComponent(saved)}`);
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await selectLora(modal, "other.safetensors");
  await expect(modal.getByRole("button", { name: "Apply strengths" })).toBeEnabled();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Preview LoRA", exact: true })).toHaveValue("demo.safetensors");
  await expect(page.getByTestId("lora-state")).toHaveText(saved);
});

test("late target responses cannot replace the newly selected LoRA", async ({ page }) => {
  let releaseOther: (() => void) | undefined;
  let markOtherStarted: (() => void) | undefined;
  const otherGate = new Promise<void>((resolve) => {
    releaseOther = resolve;
  });
  const otherStarted = new Promise<void>((resolve) => {
    markOtherStarted = resolve;
  });
  await page.route(endpoint, async (route) => {
    const name = new URL(route.request().url()).searchParams.get("lora_name");
    if (name === "other.safetensors") {
      markOtherStarted?.();
      await otherGate;
    }
    await route.fulfill({
      json: {
        lora_name: name,
        targets: name === "other.safetensors" ? ["transformer.layers.7.q"] : targets,
        unsupported: [],
      },
    });
  });
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  const selector = modal.getByRole("combobox", { name: "LoRA", exact: true });
  await expect(modal.getByRole("button", { name: "Apply strengths" })).toBeEnabled();
  await selectLora(modal, "other.safetensors");
  await otherStarted;
  await expect(modal.getByRole("button", { name: "Apply strengths" })).toBeDisabled();
  await selectLora(modal, "demo.safetensors");
  await expect(bar(modal, block0)).toBeVisible();
  const otherResponse = page.waitForResponse((response) => response.url().includes("lora_name=other.safetensors"));
  releaseOther?.();
  await otherResponse;
  await expect(selector).toHaveValue("demo");
  await expect(bar(modal, "transformer.layers.7")).toHaveCount(0);
  await modal.getByRole("button", { name: "Apply strengths" }).click();
  await expect(page.getByTestId("lora-state")).toContainText('"lora_name":"demo.safetensors"');
});

test("ComfyUI's litegraph dialog rule does not move the editor off center", async ({ page }) => {
  await page.goto("/preview/index.html?lora=1");
  // Copied from the ComfyUI frontend, which puts the litegraph class on the page body.
  await page.addStyleTag({
    content: `.litegraph .dialog { position: absolute; top: 50%; left: 50%; margin-top: -150px; margin-left: -200px; }`,
  });
  await page.evaluate(() => document.body.classList.add("litegraph"));
  const bounds = await page.getByRole("dialog", { name: "LoRA block strength editor" }).boundingBox();
  const viewport = page.viewportSize();
  expect(bounds && viewport).toBeTruthy();
  if (!bounds || !viewport) return;
  expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
  expect(bounds.y).toBe(24);
});

test("host dialog shadows and window focus outlines do not leak into the editor", async ({ page }) => {
  await page.goto("/preview/index.html?lora=1");
  await page.addStyleTag({
    content: `
    dialog { box-shadow: 0 0 18px 6px white; }
    dialog:focus-visible { outline: 2px solid white; }
  `,
  });
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await modal.evaluate((element) => element.focus());
  await expect(modal).toHaveCSS("box-shadow", "none");
  await expect(modal).toHaveCSS("outline-style", "none");
  await expect(modal.getByRole("button", { name: "Apply strengths" })).toBeEnabled();
  await modal.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Tab");
  const apply = modal.getByRole("button", { name: "Apply strengths" });
  await expect(apply).toBeFocused();
  await expect(apply).toHaveCSS("outline-style", "solid");
  await expect(apply).toHaveCSS("outline-width", "2px");
});

test("opening focuses search instead of selecting the LoRA name, and CLIP stays hidden without text encoder targets", async ({
  page,
}) => {
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await expect(modal.getByRole("searchbox", { name: "Search LoRA targets" })).toBeFocused();
  await expect(bar(modal, block0)).toBeVisible();
  await expect(modal.getByRole("spinbutton", { name: "MODEL strength", exact: true })).toBeVisible();
  await expect(modal.getByRole("spinbutton", { name: "CLIP strength", exact: true })).toHaveCount(0);
});

test("chart edits, module inheritance, selection and filters", async ({ page }) => {
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await expect(modal.getByRole("complementary", { name: "Block details" })).toHaveCount(0);
  await setBlock(modal, block0, "0.5");
  await expect(bar(modal, block0)).toHaveAttribute("aria-valuenow", "0.5");
  await expect(modal.getByRole("status").filter({ hasText: "1 override" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Changed", exact: true })).toContainText("1");
  const q = modal.getByRole("spinbutton", { name: `Multiplier ${block0}.attn.q`, exact: true });
  const k = modal.getByRole("spinbutton", { name: `Multiplier ${block0}.attn.k`, exact: true });
  await expect(q).toHaveValue("0.5");
  await setNumber(q, "0");
  await expect(k).toHaveValue("0.5");
  await modal.getByRole("button", { name: "Close block details" }).click();
  await expect(q).toHaveCount(0);
  await bar(modal, block0).click();
  await expect(q).toHaveValue("0");
  await bar(modal, block10).click({ modifiers: ["ControlOrMeta"] });
  await expect(modal.getByText("1 selected", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "Changed", exact: true }).click();
  await expect(bar(modal, block10)).toHaveClass(/dim/);
  await expect(bar(modal, block0)).not.toHaveClass(/dim/);
  await modal.getByRole("button", { name: "Changed", exact: true }).click();
  await modal.getByRole("searchbox", { name: "Search LoRA targets" }).fill("attn.q");
  await expect(bar(modal, block10)).not.toHaveClass(/dim/);
  await modal.getByRole("searchbox", { name: "Search LoRA targets" }).fill("Block 10");
  await expect(bar(modal, block0)).toHaveClass(/dim/);
});

test("drafts persist on apply, cancel restores values and numeric controls allow precise adjustment", async ({
  page,
}) => {
  await page.route(endpoint, (route) =>
    route.fulfill({
      json: { lora_name: "demo.safetensors", targets: [...targets, "text_encoders.layers.0.q"], unsupported: [] },
    }),
  );
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await setBlock(modal, block0, "0.333");
  const block = modal.getByRole("spinbutton", { name: `Multiplier ${block0}`, exact: true });
  await modal.getByRole("button", { name: `Increase Multiplier ${block0}`, exact: true }).click();
  await expect(block).toHaveValue("0.383");
  await block.press("Alt+ArrowDown");
  await expect(block).toHaveValue("0.373");
  await setNumber(modal.getByRole("spinbutton", { name: "MODEL strength", exact: true }), "0.8");
  await setNumber(modal.getByRole("spinbutton", { name: "CLIP strength", exact: true }), "0.6");
  await modal.getByRole("button", { name: "Apply strengths" }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId("lora-state")).toContainText(`"${block0}":0.373`);
  await expect(page.getByTestId("lora-globals")).toHaveText("MODEL 0.8 / CLIP 0.6");
  const saved = await page.getByTestId("lora-state").textContent();
  await page.getByRole("button", { name: "Open Strength Editor", exact: true }).click();
  await expect(bar(modal, block0)).toHaveAttribute("aria-valuenow", "0.373");
  await modal.getByRole("button", { name: "Reset overrides", exact: true }).click();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByTestId("lora-state")).toHaveText(saved ?? "");
});

test("bulk edit and reset work without overwriting module exceptions", async ({ page }) => {
  const saved = JSON.stringify({ version: 1, lora_name: "demo.safetensors", overrides: { [`${block0}.attn.q`]: 0.2 } });
  await page.goto(`/preview/index.html?lora=1&loraState=${encodeURIComponent(saved)}`);
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await expect(modal.getByRole("button", { name: "Set selected", exact: true })).toBeDisabled();
  await modal.getByRole("checkbox", { name: "Select visible blocks", exact: true }).check();
  await setNumber(modal.getByRole("spinbutton", { name: "Selected multiplier", exact: true }), "0");
  await modal.getByRole("button", { name: "Set selected", exact: true }).click();
  await expect(bar(modal, block10)).toHaveAttribute("aria-valuenow", "0");
  await bar(modal, block0).click();
  const q = modal.getByRole("spinbutton", { name: `Multiplier ${block0}.attn.q`, exact: true });
  await expect(q).toHaveValue("0.2");
  await modal.getByRole("button", { name: "Reset selected", exact: true }).click();
  await expect(q).toHaveValue("1");
  await modal.getByRole("button", { name: "Apply strengths" }).click();
  await expect(page.getByTestId("lora-state")).toContainText('"overrides":{}');
});

test("selection mismatches, invalid state and inspection failures remain recoverable", async ({ page }) => {
  const saved = JSON.stringify({ version: 1, lora_name: "other.safetensors", overrides: { diffusion_model: 0 } });
  await page.goto(`/preview/index.html?lora=1&loraState=${encodeURIComponent(saved)}`);
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await expect(modal.getByRole("alert")).toContainText("belong to other.safetensors");
  await expect(modal.getByRole("button", { name: "Apply strengths" })).toBeDisabled();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByTestId("lora-state")).toHaveText(saved);
  await page.goto("/preview/index.html?lora=1&loraState=broken");
  await expect(modal.getByRole("alert")).toContainText("Reset explicitly");
  await modal.getByRole("button", { name: "Reset overrides", exact: true }).click();
  await expect(modal.getByRole("button", { name: "Apply strengths" })).toBeEnabled();
  await modal.getByRole("button", { name: "Apply strengths" }).click();
  await page.route(endpoint, (route) => route.fulfill({ status: 400, json: { error: "Could not inspect LoRA" } }));
  await page.getByRole("button", { name: "Open Strength Editor", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Could not inspect LoRA");
  await page.unroute(endpoint);
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { lora_name: "demo.safetensors", targets, unsupported: ["unknown.weight"] } }),
  );
  await modal.getByRole("button", { name: "Retry inspection" }).click();
  await expect(bar(modal, block0)).toBeVisible();
});

const modules = ["attn_to_q", "attn_to_k", "attn_to_v", "attn_to_out", "mlp_fc1", "mlp_fc2", "norm1", "norm2"];
const realistic = [
  ...Array.from({ length: 28 }, (_, i) => modules.map((module) => `lora_unet_blocks_${i}_${module}`)).flat(),
  ...Array.from({ length: 6 }, (_, i) => modules.map((module) => `lora_unet_llm_adapter_blocks_${i}_${module}`)).flat(),
];

test("painting across bars is one undo step and redo restores it", async ({ page }) => {
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { lora_name: "demo.safetensors", targets: realistic, unsupported: [] } }),
  );
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  const first = bar(modal, "lora_unet_blocks_0");
  const last = bar(modal, "lora_unet_blocks_27");
  await expect(last).toBeVisible();
  const from = await first.boundingBox();
  const to = await last.boundingBox();
  if (!from || !to) throw new Error("Missing bar bounds");
  await page.mouse.move(from.x + from.width / 2, from.y + 1);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 1, { steps: 12 });
  await page.mouse.up();
  await expect(first).toHaveAttribute("aria-valuenow", "2");
  await expect(last).toHaveAttribute("aria-valuenow", "0");
  await expect(bar(modal, "lora_unet_blocks_7")).not.toHaveAttribute("aria-valuenow", "1");
  await expect(bar(modal, "lora_unet_llm_adapter_blocks_0")).toHaveAttribute("aria-valuenow", "1");
  await modal.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(first).toHaveAttribute("aria-valuenow", "1");
  await expect(last).toHaveAttribute("aria-valuenow", "1");
  await modal.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(last).toHaveAttribute("aria-valuenow", "0");
  await first.focus();
  await page.keyboard.press("Control+z");
  await expect(last).toHaveAttribute("aria-valuenow", "1");
});

test("family reset, module lenses, pasted weight vectors and bar keyboard controls", async ({ page }) => {
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { lora_name: "demo.safetensors", targets: realistic, unsupported: [] } }),
  );
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  const adapter = modal.getByRole("region", { name: "LLM adapter", exact: true });
  const weights = modal.getByRole("textbox", { name: "Weights LLM adapter", exact: true });
  await expect(adapter.getByRole("button", { name: "Reset LLM adapter", exact: true })).toBeDisabled();
  await setNumber(weights, "1,1");
  await expect(weights).toHaveAttribute("aria-invalid", "true");
  await setNumber(weights, "0 0 1 1 0.5 0.5");
  await expect(weights).toHaveAttribute("aria-invalid", "false");
  await expect(bar(modal, "lora_unet_llm_adapter_blocks_4")).toHaveAttribute("aria-valuenow", "0.5");
  await adapter.getByRole("button", { name: "Reset LLM adapter", exact: true }).click();
  await expect(weights).toHaveValue("1,1,1,1,1,1");

  await setBlock(modal, "lora_unet_blocks_1", "0.5");
  const lens = modal.getByRole("combobox", { name: "Module Blocks", exact: true });
  await lens.selectOption("attn_to_q");
  await expect(bar(modal, "lora_unet_blocks_1")).toHaveCount(0);
  await expect(bar(modal, "lora_unet_blocks_1_attn_to_q")).toHaveAttribute("aria-valuenow", "0.5");
  await setNumber(modal.getByRole("textbox", { name: "Weights Blocks", exact: true }), Array(28).fill("0").join(","));
  await expect(bar(modal, "lora_unet_blocks_27_attn_to_q")).toHaveAttribute("aria-valuenow", "0");
  await bar(modal, "lora_unet_blocks_3_attn_to_q").click();
  await expect(
    modal.getByRole("spinbutton", { name: "Multiplier lora_unet_blocks_3_attn_to_k", exact: true }),
  ).toHaveValue("1");
  await modal.getByRole("button", { name: "Reset Blocks", exact: true }).click();
  await expect(bar(modal, "lora_unet_blocks_27_attn_to_q")).toHaveAttribute("aria-valuenow", "1");
  await expect(bar(modal, "lora_unet_blocks_1_attn_to_q")).toHaveAttribute("aria-valuenow", "0.5");
  await modal.getByRole("button", { name: "mlp_fc1", exact: true }).click();
  await expect(lens).toHaveValue("mlp_fc1");
  await expect(bar(modal, "lora_unet_blocks_0_mlp_fc1")).toBeVisible();
  await lens.selectOption("");

  const second = bar(modal, "lora_unet_blocks_1");
  await second.focus();
  await page.keyboard.press("ArrowUp");
  await expect(second).toHaveAttribute("aria-valuenow", "0.55");
  await page.keyboard.press("ArrowRight");
  await expect(bar(modal, "lora_unet_blocks_2")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Delete");
  await expect(second).toHaveAttribute("aria-valuenow", "1");
  await bar(modal, "lora_unet_blocks_5").click({ modifiers: ["Shift"] });
  await expect(modal.getByText("5 selected", { exact: true })).toBeVisible();
});

test("scrolling adjusts the active bar or the selection and otherwise scrolls", async ({ page }) => {
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { lora_name: "demo.safetensors", targets: realistic, unsupported: [] } }),
  );
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  const active = bar(modal, "lora_unet_blocks_2");
  await active.click();
  await page.mouse.wheel(0, -100);
  await expect(active).toHaveAttribute("aria-valuenow", "1.05");
  await bar(modal, "lora_unet_blocks_9").hover();
  await page.mouse.wheel(0, -100);
  await expect(bar(modal, "lora_unet_blocks_9")).toHaveAttribute("aria-valuenow", "1");
  await bar(modal, "lora_unet_blocks_6").click({ modifiers: ["ControlOrMeta"] });
  await bar(modal, "lora_unet_blocks_7").click({ modifiers: ["ControlOrMeta"] });
  await page.mouse.wheel(0, 100);
  await page.mouse.wheel(0, 100);
  await expect(bar(modal, "lora_unet_blocks_6")).toHaveAttribute("aria-valuenow", "0.9");
  await expect(bar(modal, "lora_unet_blocks_7")).toHaveAttribute("aria-valuenow", "0.9");
  await expect(active).toHaveAttribute("aria-valuenow", "1.05");
  await modal.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(bar(modal, "lora_unet_blocks_7")).toHaveAttribute("aria-valuenow", "1");
});

test("pointer, click and wheel input inside the editor does not reach host document listeners", async ({ page }) => {
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await expect(bar(modal, block0)).toBeVisible();
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { hostEvents: seen });
    for (const type of ["pointerdown", "pointermove", "pointerup", "mousedown", "click", "wheel", "contextmenu"]) {
      document.addEventListener(type, () => seen.push(type));
    }
  });
  const box = await bar(modal, block0).boundingBox();
  if (!box) throw new Error("Missing bar bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.mouse.wheel(0, 100);
  await modal.getByRole("button", { name: "Changed", exact: true }).click({ button: "right" });
  await modal.getByRole("button", { name: "Changed", exact: true }).click();
  await expect(modal.getByRole("button", { name: "Changed", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => Reflect.get(window, "hostEvents"))).toEqual([]);
});

test("realistic underscore families stay compact on desktop and mobile", async ({ page }, testInfo) => {
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { lora_name: "demo.safetensors", targets: realistic, unsupported: [] } }),
  );
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await expect(bar(modal, "lora_unet_blocks_27")).toBeVisible();
  await modal
    .getByRole("textbox", { name: "Weights Blocks", exact: true })
    .fill("1,0.5,1,0.7,0.7,1,1,1,1.4,1.4,1,1,1,0,0,1,1,1,1,1,1,0.8,0.6,0.4,0.2,0,0,0");
  await modal.getByRole("textbox", { name: "Weights Blocks", exact: true }).press("Enter");
  await expect(bar(modal, "lora_unet_blocks_8")).toHaveAttribute("aria-valuenow", "1.4");
  expect(
    await modal.locator(".block-browser").evaluate((element) => element.scrollHeight <= element.clientHeight),
  ).toBe(true);
  await bar(modal, "lora_unet_blocks_3").hover();
  await modal.screenshot({ path: testInfo.outputPath("lora-chart.png") });
  await modal.getByRole("button", { name: "LLM adapter 6", exact: true }).click();
  await expect(bar(modal, "lora_unet_blocks_27")).toHaveCount(0);
  await bar(modal, "lora_unet_llm_adapter_blocks_0").click();
  await modal.screenshot({ path: testInfo.outputPath("lora-chart-modules.png") });
  await modal.getByRole("searchbox", { name: "Search block modules", exact: true }).fill("to_q");
  await expect(
    modal.getByRole("spinbutton", { name: "Multiplier lora_unet_llm_adapter_blocks_0_attn_to_q", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 760 });
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await modal.screenshot({ path: testInfo.outputPath("lora-chart-mobile-modules.png") });
  await modal.getByRole("button", { name: "All 34", exact: true }).click();
  await modal.getByRole("button", { name: "Close block details" }).click();
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await modal.screenshot({ path: testInfo.outputPath("lora-chart-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
});
