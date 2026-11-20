import { expect, type Page } from "@playwright/test";
import { layoutPresetPayloadSchema } from "../src/layout/api";
import { parseEditorState, type EditorModel, type LayoutPreset } from "../src/layout/state";
import { test } from "./fixtures";

type PresetServer = { presets: LayoutPreset[]; revision: number; saves: number };

async function mockPresets(page: Page, presets: LayoutPreset[] = []): Promise<PresetServer> {
  const server: PresetServer = { presets, revision: 1, saves: 0 };
  await page.route("**/neriss_comfynodes/editor/presets", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      if (request.headers()["if-match"] !== `"${server.revision}"`)
        return route.fulfill({ status: 409, json: { error: "layout_presets.json changed in another tab; reload" } });
      server.presets = layoutPresetPayloadSchema.parse(request.postDataJSON()).presets;
      server.revision += 1;
      server.saves += 1;
    }
    await route.fulfill({ json: { presets: server.presets }, headers: { ETag: `"${server.revision}"` } });
  });
  return server;
}

async function openPresets(page: Page, model: EditorModel) {
  await page.goto(`/preview/index.html?model=${model}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Presets", exact: true }).click();
}

async function readState(page: Page) {
  return parseEditorState(await page.getByTestId("saved-state").textContent())._unsafeUnwrap();
}

function preset(page: Page, name: string) {
  return page.getByRole("group", { name, exact: true });
}

test("moss: parts save and apply individually, and items can replace or append", async ({ page }, testInfo) => {
  const server = await mockPresets(page);
  await openPresets(page, "moss");
  const original = await readState(page);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Bookshop items");
  const parts = page.getByRole("group", { name: "Parts to save", exact: true });
  await expect(parts.getByRole("checkbox")).toHaveCount(4);
  await parts.getByRole("checkbox", { name: "Caption", exact: true }).uncheck();
  await parts.getByRole("checkbox", { name: "Meta", exact: true }).uncheck();
  await parts.getByRole("checkbox", { name: "Canvas", exact: true }).uncheck();
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(preset(page, "Bookshop items")).toContainText("Items 9");
  expect(Object.keys(server.presets[0]?.parts ?? {})).toEqual(["elements"]);

  await preset(page, "Bookshop items").getByRole("button", { name: "Apply…", exact: true }).click();
  await page.getByRole("button", { name: "Append", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const appended = await readState(page);
  expect(appended.elements).toHaveLength(18);
  expect(new Set(appended.elements.map((region) => region.id)).size).toBe(18);
  expect(appended.high_level_description).toBe(original.high_level_description);

  await preset(page, "Bookshop items").getByRole("button", { name: "Apply…", exact: true }).click();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect((await readState(page)).elements).toHaveLength(9);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await readState(page)).elements).toHaveLength(18);
  await page.screenshot({ path: testInfo.outputPath("moss-presets.png") });
});

test("the canvas size applies only when chosen and items keep their relative placement", async ({ page }) => {
  const server = await mockPresets(page);
  await openPresets(page, "moss");
  const original = await readState(page);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Portrait layout");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(preset(page, "Portrait layout")).toContainText(`Canvas ${original.width}×${original.height}`);
  expect(server.presets[0]?.parts.canvas).toEqual({
    width: original.width,
    height: original.height,
    megapixels: original.megapixels,
    side_step: original.side_step,
    size_mode: original.size_mode,
    target_locked: original.target_locked,
  });

  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  const swapped = await readState(page);
  expect([swapped.width, swapped.height]).toEqual([original.height, original.width]);

  const apply = async (parts: string[]) => {
    await preset(page, "Portrait layout").getByRole("button", { name: "Apply…", exact: true }).click();
    const choices = preset(page, "Portrait layout").getByRole("group", { name: "Parts to apply", exact: true });
    for (const part of ["Items", "Caption", "Meta", "Canvas"])
      await choices.getByRole("checkbox", { name: part, exact: true }).setChecked(parts.includes(part));
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    return readState(page);
  };
  const itemsOnly = await apply(["Items"]);
  expect([itemsOnly.width, itemsOnly.height]).toEqual([swapped.width, swapped.height]);
  expect(itemsOnly.elements.map((region) => region.bbox)).toEqual(original.elements.map((region) => region.bbox));
  const canvasOnly = await apply(["Canvas"]);
  expect([canvasOnly.width, canvasOnly.height]).toEqual([original.width, original.height]);
  expect(canvasOnly.elements).toEqual(itemsOnly.elements);
});

test("presets are shared between editors and parts for the other editor are marked", async ({ page }) => {
  await mockPresets(page, [
    {
      id: "style",
      name: "Ink style",
      parts: {
        style_description: {
          mode: "art",
          aesthetics: "ink",
          lighting: "flat",
          medium: "ink",
          art_style: "sumi-e",
          photo: "photograph",
          color_palette: ["#000000"],
        },
        high_level_description: "A crane over a pond",
      },
    },
  ]);
  await openPresets(page, "moss");
  await expect(preset(page, "Ink style")).toContainText("Caption · Style (Ideogram 4 only)");
  await preset(page, "Ink style").getByRole("button", { name: "Apply…", exact: true }).click();
  await expect(page.getByRole("group", { name: "Parts to apply", exact: true }).getByRole("checkbox")).toHaveCount(1);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect((await readState(page)).high_level_description).toBe("A crane over a pond");

  await openPresets(page, "ideogram");
  await preset(page, "Ink style").getByRole("button", { name: "Apply…", exact: true }).click();
  await preset(page, "Ink style").getByRole("checkbox", { name: "Description", exact: true }).uncheck();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const state = await readState(page);
  expect(state.style_description.art_style).toBe("sumi-e");
  expect(state.high_level_description).not.toBe("A crane over a pond");
});

test("presets can be overwritten, renamed, updated, reordered, searched and deleted", async ({ page }) => {
  const server = await mockPresets(page);
  await openPresets(page, "moss");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  for (const value of ["First", "Second"]) {
    await name.fill(value);
    await page.getByRole("button", { name: "Save preset", exact: true }).click();
    await expect(preset(page, value)).toBeVisible();
  }
  await name.fill("First");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(page.getByText("Replace the saved preset “First”?")).toBeVisible();
  expect(server.saves).toBe(2);
  await page.getByRole("button", { name: "Replace preset", exact: true }).click();
  await expect(name).toHaveValue("");
  expect(server.saves).toBe(3);
  expect(server.presets.map((item) => item.name)).toEqual(["First", "Second"]);

  await preset(page, "Second").getByRole("button", { name: "Reorder Second", exact: true }).press("ArrowUp");
  await expect.poll(() => server.presets.map((item) => item.name)).toEqual(["Second", "First"]);

  await preset(page, "First").getByRole("button", { name: "More actions for First", exact: true }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "New name", exact: true }).fill("Renamed");
  await page.getByRole("textbox", { name: "New name", exact: true }).press("Enter");
  await expect(preset(page, "Renamed")).toBeVisible();

  await page.getByRole("button", { name: "Scene & style", exact: true }).click();
  await page.getByRole("textbox", { name: "Scene caption", exact: true }).fill("Updated caption");
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await preset(page, "Renamed").getByRole("button", { name: "More actions for Renamed", exact: true }).click();
  await page.getByRole("button", { name: "Update…", exact: true }).click();
  const update = page.getByRole("group", { name: "Replace with the current editor values", exact: true });
  await update.getByRole("checkbox", { name: "Items", exact: true }).uncheck();
  await update.getByRole("checkbox", { name: "Meta", exact: true }).uncheck();
  await update.getByRole("checkbox", { name: "Canvas", exact: true }).uncheck();
  await page.getByRole("button", { name: "Update preset", exact: true }).click();
  await expect(page.getByText("Updated caption in Renamed.")).toBeVisible();
  const updated = server.presets.find((item) => item.name === "Renamed")?.parts;
  expect(updated?.high_level_description).toBe("Updated caption");
  expect(updated?.elements).toHaveLength(9);

  await page.getByRole("searchbox", { name: "Search presets", exact: true }).fill("renam");
  await expect(page.locator(".preset-item")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Reorder Renamed", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search presets", exact: true }).fill("");

  await preset(page, "Second").getByRole("button", { name: "More actions for Second", exact: true }).click();
  await page.getByRole("button", { name: "Delete…", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Delete preset", exact: true })).toHaveCount(0);
  await expect(preset(page, "Second").getByRole("button", { name: "Apply…", exact: true })).toBeFocused();
  await expect(page.getByRole("dialog")).toBeVisible();
  await preset(page, "Second").getByRole("button", { name: "More actions for Second", exact: true }).click();
  await page.getByRole("button", { name: "Delete…", exact: true }).click();
  await page.getByRole("button", { name: "Delete preset", exact: true }).click();
  await expect.poll(() => server.presets.map((item) => item.name)).toEqual(["Renamed"]);
});

test("clipboard round trips presets with fresh IDs and unique names", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const server = await mockPresets(page, [{ id: "meta", name: "Tags", parts: { moss_meta: ["ink"] } }]);
  await openPresets(page, "moss");
  await page.getByRole("button", { name: "Copy all presets", exact: true }).click();
  await expect(page.getByText("Copied all presets.")).toBeVisible();
  await page.getByRole("button", { name: "Paste presets", exact: true }).click();
  await expect(preset(page, "Tags (2)")).toBeVisible();
  expect(server.presets.map((item) => item.name)).toEqual(["Tags", "Tags (2)"]);
  expect(server.presets[1]?.id).not.toBe("meta");

  await page.evaluate(() => navigator.clipboard.writeText('{"presets": [{"id": "x", "name": "Bad", "parts": {}}]}'));
  await page.getByRole("button", { name: "Paste presets", exact: true }).click();
  await expect(page.getByText("Clipboard does not contain layout presets")).toBeVisible();
  expect(server.presets).toHaveLength(2);
});

test("a conflicting save keeps the list and recovers after reloading", async ({ page }) => {
  const server = await mockPresets(page, [{ id: "meta", name: "Tags", parts: { moss_meta: ["ink"] } }]);
  await openPresets(page, "moss");
  await expect(preset(page, "Tags")).toBeVisible();
  server.presets = [...server.presets, { id: "other", name: "Other tab", parts: { moss_meta: [] } }];
  server.revision += 1;
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Mine");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  const alert = page.locator(".sidebar-content").getByRole("alert");
  await expect(alert).toContainText("changed in another tab");
  await expect(preset(page, "Tags")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save preset", exact: true })).toBeDisabled();
  await alert.getByRole("button", { name: "Reload latest presets", exact: true }).click();
  await expect(preset(page, "Other tab")).toBeVisible();
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(preset(page, "Mine")).toBeVisible();
  expect(server.presets.map((item) => item.name)).toEqual(["Tags", "Other tab", "Mine"]);
});
