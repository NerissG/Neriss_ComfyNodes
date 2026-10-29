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
  await expect(modal.getByRole("option")).toHaveCount(1);
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
  expect(await modal.getByRole("option").count()).toBeLessThan(24);
  await picker.press("End");
  const active = await picker.getAttribute("aria-activedescendant");
  expect(active).not.toBeNull();
  if (active) await expect(modal.locator(`[id="${active}"]`)).toBeVisible();
  await modal.getByRole("listbox", { name: "LoRAs", exact: true }).evaluate((element) => (element.scrollTop = 0));
  await expect(modal.getByRole("option", { name: "demo.safetensors", exact: true })).toBeVisible();
  await expect(picker).not.toHaveAttribute("aria-activedescendant", /.+/);
  await picker.fill("nothing_matches_this_name");
  await expect(modal.getByRole("option")).toHaveCount(0);
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
  await expect(modal.getByRole("option")).toHaveCount(2);
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
  await setNumber(modal.getByRole("spinbutton", { name: `Multiplier ${block0}`, exact: true }), "0.5");
  await selectLora(modal, "other.safetensors");
  const other = modal.getByRole("spinbutton", { name: "Multiplier transformer.layers.7", exact: true });
  await expect(other).toHaveValue("1");
  await expect(modal.getByRole("spinbutton", { name: `Multiplier ${block0}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Preview LoRA", exact: true })).toHaveValue("demo.safetensors");
  await setNumber(other, "0.8");
  await selectLora(modal, "demo.safetensors");
  await expect(modal.getByRole("spinbutton", { name: `Multiplier ${block0}`, exact: true })).toHaveValue("0.5");
  await selectLora(modal, "other.safetensors");
  await expect(other).toHaveValue("0.8");
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
  await expect(modal.getByRole("spinbutton", { name: `Multiplier ${block0}`, exact: true })).toBeVisible();
  const otherResponse = page.waitForResponse((response) => response.url().includes("lora_name=other.safetensors"));
  releaseOther?.();
  await otherResponse;
  await expect(selector).toHaveValue("demo");
  await expect(modal.getByRole("spinbutton", { name: "Multiplier transformer.layers.7", exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "Apply strengths" }).click();
  await expect(page.getByTestId("lora-state")).toContainText('"lora_name":"demo.safetensors"');
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

test("grid retains edits, module inheritance, selection and filters without a view switch", async ({ page }) => {
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  const block = modal.getByRole("spinbutton", { name: `Multiplier ${block0}`, exact: true });
  await setNumber(block, "0.5");
  await modal.getByRole("checkbox", { name: `Select ${block0}`, exact: true }).check();
  await expect(modal.getByRole("group", { name: "Block view", exact: true })).toHaveCount(0);
  await expect(modal.getByRole("button", { name: /^(List|Grid)$/ })).toHaveCount(0);
  await expect(block).toHaveValue("0.5");
  await expect(modal.getByRole("checkbox", { name: `Select ${block0}`, exact: true })).toBeChecked();
  await modal.getByRole("button", { name: `Modules ${block0}`, exact: true }).click();
  const q = modal.getByRole("spinbutton", { name: `Multiplier ${block0}.attn.q`, exact: true });
  const k = modal.getByRole("spinbutton", { name: `Multiplier ${block0}.attn.k`, exact: true });
  await expect(q).toHaveValue("0.5");
  await setNumber(q, "0");
  await expect(k).toHaveValue("0.5");
  await modal.getByRole("button", { name: "Close module details" }).click();
  await modal.getByRole("button", { name: `Modules ${block0}`, exact: true }).click();
  await expect(q).toHaveValue("0");
  await modal.getByRole("button", { name: "Close module details" }).click();
  await modal.getByRole("button", { name: "Changed", exact: true }).click();
  await expect(modal.getByRole("spinbutton", { name: `Multiplier ${block10}`, exact: true })).toHaveCount(0);
  await expect(block).toHaveValue("0.5");
  await modal.getByRole("button", { name: "Changed", exact: true }).click();
  await modal.getByRole("textbox", { name: "Search LoRA targets" }).fill("attn.q");
  await expect(modal.getByRole("spinbutton", { name: `Multiplier ${block10}`, exact: true })).toBeVisible();
  await modal.getByRole("textbox", { name: "Search LoRA targets" }).fill("Block 10");
  await expect(block).toHaveCount(0);
});

test("drafts persist on apply, cancel restores values and numeric controls allow precise adjustment", async ({
  page,
}) => {
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  const block = modal.getByRole("spinbutton", { name: `Multiplier ${block0}`, exact: true });
  await setNumber(block, "0.333");
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
  await expect(block).toHaveValue("0.373");
  await modal.getByRole("button", { name: "Reset overrides", exact: true }).click();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByTestId("lora-state")).toHaveText(saved ?? "");
});

test("bulk edit and reset work without overwriting module exceptions", async ({ page }) => {
  const saved = JSON.stringify({ version: 1, lora_name: "demo.safetensors", overrides: { [`${block0}.attn.q`]: 0.2 } });
  await page.goto(`/preview/index.html?lora=1&loraState=${encodeURIComponent(saved)}`);
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await modal.getByRole("checkbox", { name: "Select visible blocks", exact: true }).check();
  await setNumber(modal.getByRole("spinbutton", { name: "Selected block multiplier", exact: true }), "0");
  await modal.getByRole("button", { name: "Set selected", exact: true }).click();
  await expect(modal.getByRole("spinbutton", { name: `Multiplier ${block10}`, exact: true })).toHaveValue("0");
  await modal.getByRole("button", { name: `Modules ${block0}`, exact: true }).click();
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
  await expect(modal.getByRole("spinbutton", { name: `Multiplier ${block0}`, exact: true })).toBeVisible();
});

test("realistic underscore families stay compact in grid and mobile module views", async ({ page }, testInfo) => {
  const modules = ["attn_to_q", "attn_to_k", "attn_to_v", "attn_to_out", "mlp_fc1", "mlp_fc2", "norm1", "norm2"];
  const realistic = [
    ...Array.from({ length: 28 }, (_, i) => modules.map((module) => `lora_unet_blocks_${i}_${module}`)).flat(),
    ...Array.from({ length: 6 }, (_, i) =>
      modules.map((module) => `lora_unet_llm_adapter_blocks_${i}_${module}`),
    ).flat(),
  ];
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { lora_name: "demo.safetensors", targets: realistic, unsupported: [] } }),
  );
  await page.goto("/preview/index.html?lora=1");
  const modal = page.getByRole("dialog", { name: "LoRA block strength editor" });
  await expect(modal.getByRole("spinbutton", { name: "Multiplier lora_unet_blocks_27", exact: true })).toBeVisible();
  await setNumber(modal.getByRole("spinbutton", { name: "Multiplier lora_unet_blocks_1", exact: true }), "0.5");
  await setNumber(modal.getByRole("spinbutton", { name: "Multiplier lora_unet_blocks_3", exact: true }), "0.7");
  await setNumber(modal.getByRole("spinbutton", { name: "Multiplier lora_unet_blocks_4", exact: true }), "0.7");
  expect(
    await modal.locator(".block-browser").evaluate((element) => element.scrollHeight <= element.clientHeight),
  ).toBe(true);
  expect(
    await modal.locator(".card").evaluateAll((cards) =>
      cards.every((card) => {
        const bounds = card.getBoundingClientRect();
        const input = card.querySelector(".stepper")?.getBoundingClientRect();
        return input !== undefined && input.left >= bounds.left && input.right <= bounds.right;
      }),
    ),
  ).toBe(true);
  await expect(modal.getByText("Effective strength", { exact: false })).toHaveCount(0);
  await modal.screenshot({ path: testInfo.outputPath("lora-compact-grid.png") });
  await modal.getByRole("button", { name: "LLM adapter 6", exact: true }).click();
  await expect(modal.getByRole("spinbutton", { name: "Multiplier lora_unet_blocks_27", exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "Modules lora_unet_llm_adapter_blocks_0", exact: true }).click();
  await modal.screenshot({ path: testInfo.outputPath("lora-compact-desktop-modules.png") });
  await modal.getByRole("textbox", { name: "Search block modules", exact: true }).fill("to_q");
  await expect(
    modal.getByRole("spinbutton", { name: "Multiplier lora_unet_llm_adapter_blocks_0_attn_to_q", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 760 });
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await modal.screenshot({ path: testInfo.outputPath("lora-compact-mobile-modules.png") });
  await modal.getByRole("button", { name: "Close module details" }).click();
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await modal.screenshot({ path: testInfo.outputPath("lora-compact-mobile-grid.png") });
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
});
