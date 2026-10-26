import { z } from "zod";
import { resolutionPresetSchema } from "../src/resolution/presets";
import { Buffer } from "node:buffer";
import { expect, type Page } from "@playwright/test";
import { parseEditorState, type EditorModel } from "../src/editor/state";
import { IdeogramV4JsonPromptSchema } from "../src/ideogram/schema";
import { mockUiSettings } from "./settings-mock";
import { test } from "./fixtures";

async function openEditor(page: Page, model: EditorModel = "moss", empty = false) {
  await page.route("**/neriss_comfynodes/resolution/presets", (route) =>
    route.fulfill({
      json: {
        presets: [
          { name: "My banner", x: 7, y: 2 },
          { name: "My poster", x: 3, y: 5 },
        ],
      },
    }),
  );
  await page.goto(`/preview/index.html?model=${model}${empty ? "&empty=1" : ""}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".region-item")).toHaveCount(empty ? 0 : 9);
}

async function readState(page: Page) {
  // A failed parse is a test failure, never a fallback to another state.
  return parseEditorState(await page.getByTestId("saved-state").textContent())._unsafeUnwrap();
}

async function drawSelectedRegion(page: Page) {
  await page.getByRole("button", { name: "Draw box", exact: true }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const frame = await page.locator("svg > g > rect").first().boundingBox();
  expect(frame).not.toBeNull();
  if (!frame) return;
  await page.mouse.move(frame.x + frame.width * 0.2, frame.y + frame.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.35, frame.y + frame.height * 0.3, { steps: 8 });
  await page.mouse.up();
}

for (const model of ["moss", "ideogram"] satisfies EditorModel[]) {
  for (const count of [3, 4]) {
    test(`${model}: modifier-click cycles through all ${count} stacked elements`, async ({ page }) => {
      await openEditor(page, model, true);
      const canvas = page.getByRole("application", { name: "Layout canvas" });
      const frame = await canvas.locator(".canvas-frame").boundingBox();
      const bounds = await canvas.boundingBox();
      expect(frame).not.toBeNull();
      expect(bounds).not.toBeNull();
      if (!frame || !bounds) return;
      const position = {
        x: frame.x - bounds.x + frame.width * 0.4,
        y: frame.y - bounds.y + frame.height * 0.4,
      };
      for (let index = 0; index < count; index += 1) {
        await page.getByRole("button", { name: "Object", exact: true }).click();
        await page.mouse.move(frame.x + frame.width * 0.2, frame.y + frame.height * 0.2);
        await page.mouse.down();
        await page.mouse.move(frame.x + frame.width * 0.6, frame.y + frame.height * 0.6, { steps: 4 });
        await page.mouse.up();
      }
      const original = await readState(page);
      const topToBottom = [...original.elements].reverse();
      for (const modifier of ["Control", "Meta"] satisfies ("Control" | "Meta")[]) {
        await canvas.click({ position: { x: 100, y: 10 } });
        expect((await readState(page)).selected_region_id).toBeNull();
        for (let round = 0; round < 2; round += 1) {
          for (const region of topToBottom) {
            await canvas.click({ position, modifiers: [modifier] });
            expect((await readState(page)).selected_region_id).toBe(region.id);
            await expect(canvas.locator(".region").last()).toHaveAttribute("aria-pressed", "true");
          }
        }
      }
      expect((await readState(page)).elements).toEqual(original.elements);
    });
  }

  test(`${model}: customized shortcuts persist, update hints and stay out of text fields`, async ({
    page,
  }, testInfo) => {
    const storage = await mockUiSettings(page);
    await openEditor(page, model);
    const original = await readState(page);
    await page.getByRole("button", { name: "Editor settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Editor settings", exact: true });
    await settings.getByRole("button", { name: "Change Object tool binding 1", exact: true }).click();
    await page.keyboard.press("b");
    await settings.getByRole("button", { name: "More options for Object tool", exact: true }).click();
    await settings.getByRole("button", { name: "Add Object tool binding", exact: true }).click();
    await page.keyboard.press("Shift+B");
    for (const width of [1674, 390]) {
      await page.setViewportSize({ width, height: 1010 });
      expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await settings.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(580);
      await page.screenshot({ path: testInfo.outputPath(`shortcut-settings-${width}.png`) });
      await settings.screenshot({ path: testInfo.outputPath(`shortcut-dialog-${width}.png`) });
    }
    await page.setViewportSize({ width: 1674, height: 1010 });
    await settings.getByRole("button", { name: "Save shortcuts", exact: true }).click();
    await expect(settings).toHaveCount(0);
    expect(storage.saves).toHaveLength(1);
    expect(await readState(page)).toEqual(original);
    const object = page.getByRole("button", { name: "Object", exact: true });
    await expect(object).toHaveAttribute("aria-keyshortcuts", "B Shift+B");
    await expect(object.locator("kbd")).toHaveText("B / Shift+B");
    const editor = page.getByRole("dialog");
    await editor.focus();
    await page.keyboard.press("o");
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("b");
    await expect(object).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("v");
    await page.keyboard.press("Shift+B");
    await expect(object).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("v");
    const field = page
      .locator(".region-details")
      .getByRole("textbox", { name: model === "moss" ? "Caption" : "Description", exact: true });
    await field.focus();
    await page.keyboard.press("b");
    await expect(object).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(object).toHaveAttribute("aria-keyshortcuts", "B Shift+B");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await page
      .getByRole("button", { name: model === "moss" ? "Open Ideogram editor" : "Open MOSS editor", exact: true })
      .click();
    await expect(object).toHaveAttribute("aria-keyshortcuts", "B Shift+B");
  });
}

test("shortcut settings detect conflicts, reserve native keys, isolate modal input and reset defaults", async ({
  page,
}) => {
  const storage = await mockUiSettings(page);
  await openEditor(page);
  const original = await readState(page);
  const opener = page.getByRole("button", { name: "Editor settings", exact: true });
  await opener.click();
  const settings = page.getByRole("dialog", { name: "Editor settings", exact: true });
  await settings.getByRole("button", { name: "Save shortcuts", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(settings.getByRole("button", { name: "Close settings", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(settings.getByRole("button", { name: "Save shortcuts", exact: true })).toBeFocused();
  await settings.getByRole("button", { name: "Change Select tool binding 1", exact: true }).click();
  await page.keyboard.press("Control+v");
  await expect(settings.getByRole("status")).toContainText("reserved");
  await page.keyboard.press("Escape");
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Change Select tool binding 1", exact: true }).click();
  await page.keyboard.press("o");
  await expect(settings.getByRole("alert")).toContainText("conflicts with");
  await expect(settings.getByRole("button", { name: "Save shortcuts", exact: true })).toBeDisabled();
  await settings.getByRole("button", { name: "More options for Select tool", exact: true }).click();
  await settings.getByRole("button", { name: "Reset Select tool", exact: true }).click();
  await settings.getByRole("button", { name: "Remove Object tool binding 1", exact: true }).click();
  await expect(settings.getByRole("group", { name: "Object tool", exact: true })).toContainText("Disabled");
  await settings.getByRole("searchbox", { name: "Search shortcuts" }).fill("Fit canvas");
  await expect(settings.getByRole("group")).toHaveCount(1);
  await page.keyboard.press("Delete");
  expect(await readState(page)).toEqual(original);
  await settings.getByRole("searchbox").fill("");
  await settings.getByRole("button", { name: "Save shortcuts", exact: true }).click();
  await expect(opener).toBeFocused();
  await expect(page.getByRole("button", { name: "Object", exact: true })).not.toHaveAttribute("aria-keyshortcuts");
  await page.getByRole("dialog").focus();
  await page.keyboard.press("o");
  await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  await opener.click();
  await settings.getByRole("button", { name: "Reset all shortcuts", exact: true }).click();
  await settings.getByRole("button", { name: "Save shortcuts", exact: true }).click();
  await expect(settings).toHaveCount(0);
  expect(storage.settings.editor.shortcuts).toEqual({});
  await expect(page.getByRole("button", { name: "Object", exact: true })).toHaveAttribute("aria-keyshortcuts", "O");
  await opener.click();
  await settings.getByRole("button", { name: "Change Select tool binding 1", exact: true }).click();
  await page.keyboard.press("g");
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  expect(storage.settings.editor.shortcuts).toEqual({});
  expect(await readState(page)).toEqual(original);
});

test("shortcut categories stay compact and row options work with keyboard and small viewports", async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Editor settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Editor settings", exact: true });
  const categories = settings.getByRole("navigation", { name: "Shortcut categories" });
  await expect(settings.getByRole("button", { name: /^Reset / })).toHaveCount(1);
  await page.mouse.move(0, 0);
  await settings.screenshot({ path: testInfo.outputPath("shortcut-default.png") });
  for (const viewport of [
    { width: 1366, height: 800 },
    { width: 390, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(settings.locator("header").getByRole("searchbox", { name: "Search shortcuts" })).toBeVisible();
    expect(
      await settings.locator("header").evaluate((element) => element.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(viewport.width > 600 ? 50 : 82);
    expect(
      await settings.locator("footer").evaluate((element) => element.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(48);
    expect(await settings.locator(".feedback").evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
    await settings.screenshot({ path: testInfo.outputPath(`shortcut-compact-bars-${viewport.width}.png`) });
  }
  for (const [label, count] of [
    ["Tools", 5],
    ["Editing", 3],
    ["View", 7],
    ["Movement", 8],
  ] satisfies [string, number][]) {
    await categories.getByRole("button", { name: new RegExp(`^${label}`) }).click();
    await expect(settings.locator(".shortcut-row")).toHaveCount(count);
    await expect(categories.getByRole("button", { pressed: true })).toContainText(label);
  }
  for (const viewport of [
    { width: 1366, height: 800 },
    { width: 390, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await settings.getByRole("button", { name: "More options for Move down (10 px)", exact: true }).focus();
    await page.keyboard.press("Enter");
    const options = settings.getByRole("group", { name: "Move down (10 px) options", exact: true });
    await expect(options.getByRole("button", { name: "Add Move down (10 px) binding", exact: true })).toBeFocused();
    const bounds = await settings.boundingBox();
    const menuBounds = await options.boundingBox();
    expect(bounds).not.toBeNull();
    expect(menuBounds).not.toBeNull();
    if (bounds && menuBounds) {
      expect(menuBounds.y).toBeGreaterThanOrEqual(bounds.y);
      expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    await page.keyboard.press("Escape");
    await expect(options).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(
      settings.getByRole("button", { name: "More options for Move down (10 px)", exact: true }),
    ).toBeFocused();
    await settings.screenshot({ path: testInfo.outputPath(`shortcut-movement-${viewport.width}.png`) });
  }
  await settings.getByRole("searchbox").fill("redo");
  await expect(settings.locator(".shortcut-row")).toHaveCount(1);
  await expect(settings.getByRole("group", { name: "Redo", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "More options for Redo", exact: true }).click();
  await settings.getByRole("button", { name: "Disable command", exact: true }).click();
  await expect(settings.getByRole("group", { name: "Redo", exact: true })).toContainText("Disabled");
  await settings.getByRole("button", { name: "More options for Redo", exact: true }).click();
  await settings.getByRole("button", { name: "Reset Redo", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Change Redo binding 1", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Change Redo binding 2", exact: true }).click();
  await page.keyboard.press("Tab");
  await expect(settings.getByRole("button", { name: "Save shortcuts", exact: true })).toBeEnabled();
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("custom canvas movement and panel shortcuts respect focus, exact modifiers and document history", async ({
  page,
}) => {
  const storage = await mockUiSettings(page, {
    version: 1,
    editor: {
      sidebarWidth: 530,
      shortcuts: {
        "canvas.left": [{ key: "b", modifiers: [] }],
        "panel.canvas": [{ key: "k", modifiers: ["Alt"] }],
      },
    },
  });
  await openEditor(page);
  const original = await readState(page);
  await expect(page.getByRole("dialog")).toHaveCSS("--sidebar-width", "530px");
  await page.getByRole("dialog").focus();
  await page.keyboard.press("b");
  expect(await readState(page)).toEqual(original);
  const canvas = page.getByRole("application", { name: "Layout canvas" });
  await canvas.focus();
  await page.keyboard.press("Control+b");
  expect(await readState(page)).toEqual(original);
  await page.keyboard.press("b");
  expect(await readState(page)).not.toEqual(original);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await readState(page)).toEqual(original);
  await page.keyboard.press("Alt+k");
  const tab = page
    .getByRole("navigation", { name: "Editor sections" })
    .getByRole("button", { name: "Canvas", exact: true });
  await expect(tab).toHaveAttribute("aria-pressed", "true");
  await expect(tab).toHaveAttribute("aria-keyshortcuts", "Alt+K");
  const resize = page.getByRole("button", { name: "Resize sidebar; use left and right arrow keys", exact: true });
  await resize.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => storage.settings.editor.sidebarWidth).toBe(510);
  expect(storage.settings.editor.shortcuts["canvas.left"]).toEqual([{ key: "b", modifiers: [] }]);
  expect(await readState(page)).toEqual(original);
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCSS("--sidebar-width", "510px");
});

test("unreadable UI settings block saves, remain usable with defaults and can be retried", async ({ page }) => {
  const storage = await mockUiSettings(page);
  storage.loadError = true;
  await openEditor(page);
  await expect(page.getByRole("alert")).toContainText("unreadable");
  await page.getByRole("dialog").focus();
  await page.keyboard.press("o");
  await expect(page.getByRole("button", { name: "Object", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Editor settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Editor settings", exact: true });
  await expect(settings.getByRole("alert")).toContainText("saved file has not been replaced");
  await expect(settings.getByRole("button", { name: "Save shortcuts" })).toHaveCount(0);
  expect(storage.saves).toHaveLength(0);
  storage.loadError = false;
  await settings.getByRole("button", { name: "Retry loading settings", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Save shortcuts", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(storage.saves).toHaveLength(0);
});

test("failed shortcut saves stay as drafts, can be retried, and cancel does not leak them into later saves", async ({
  page,
}) => {
  const storage = await mockUiSettings(page);
  await openEditor(page);
  const opener = page.getByRole("button", { name: "Editor settings", exact: true });
  const settings = page.getByRole("dialog", { name: "Editor settings", exact: true });
  await opener.click();
  await settings.getByRole("button", { name: "Change Select tool binding 1", exact: true }).click();
  await page.keyboard.press("b");
  storage.saveError = true;
  await settings.getByRole("button", { name: "Save shortcuts", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("not been saved");
  expect(storage.settings.editor.shortcuts).toEqual({});
  storage.saveError = false;
  await settings.getByRole("button", { name: "Save shortcuts", exact: true }).click();
  await expect(settings).toHaveCount(0);
  expect(storage.settings.editor.shortcuts).toEqual({ "tool.select": [{ key: "b", modifiers: [] }] });
  await opener.click();
  await settings.getByRole("button", { name: "Change Select tool binding 1", exact: true }).click();
  await page.keyboard.press("g");
  storage.saveError = true;
  await settings.getByRole("button", { name: "Save shortcuts", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("not been saved");
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  storage.saveError = false;
  await page.getByRole("button", { name: "Resize sidebar; use left and right arrow keys", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => storage.settings.editor.sidebarWidth).toBe(410);
  expect(storage.settings.editor.shortcuts).toEqual({ "tool.select": [{ key: "b", modifiers: [] }] });
});

for (const model of ["moss", "ideogram"] satisfies EditorModel[]) {
  test(`${model}: section shortcuts switch tabs, reopen the panel and preserve canvas zoom`, async ({ page }) => {
    await openEditor(page, model);
    const original = await readState(page);
    const dialog = page.getByRole("dialog");
    const tabs = page.getByRole("navigation", { name: "Editor sections" });
    const frame = page.locator("svg > g[transform]").first();
    const originalTransform = await frame.getAttribute("transform");
    for (const [key, label] of [
      ["2", "Scene & style"],
      ["3", "Canvas"],
      ["1", "Regions"],
    ]) {
      await dialog.focus();
      await page.keyboard.press(`Alt+${key}`);
      const tab = tabs.getByRole("button", { name: label, exact: true });
      await expect(tab).toHaveAttribute("aria-pressed", "true");
      await expect(tab).toHaveAttribute("aria-keyshortcuts", `Alt+${key}`);
      await expect(tab).toHaveAttribute("title", `${label} (Alt+${key})`);
      await expect(frame).toHaveAttribute("transform", originalTransform ?? "");
    }
    const caption = page
      .locator(".region-details")
      .getByRole("textbox", { name: model === "moss" ? "Caption" : "Description", exact: true });
    await caption.focus();
    await page.keyboard.press("Alt+2");
    await expect(caption).toBeFocused();
    await expect(tabs.getByRole("button", { name: "Regions", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Hide panel", exact: true }).click();
    await expect(page.locator(".editor-sidebar")).toHaveCount(0);
    await page.keyboard.press("Alt+3");
    await expect(tabs.getByRole("button", { name: "Canvas", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await readState(page)).toEqual(original);
    await dialog.focus();
    await page.keyboard.press("1");
    await expect(frame).not.toHaveAttribute("transform", originalTransform ?? "");
    await expect(tabs.getByRole("button", { name: "Canvas", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test(`${model}: selected-region metadata stays compact and keeps type and parent editing visible`, async ({
    page,
  }, testInfo) => {
    await openEditor(page, model);
    const details = page.locator(".region-details");
    await expect(details.locator("details").first()).toHaveAttribute("open", "");
    await expect(details.locator("details > summary").first()).toContainText("Palette");
    await expect(details.getByRole("button", { name: "Add region palette color", exact: true })).toBeVisible();
    const types = details.getByRole("group", { name: "Type", exact: true });
    const parent = details.getByRole("combobox", { name: "Parent", exact: true });
    const selectedRegion = async () => (await readState(page)).elements.find((region) => region.id === "reader");
    await expect(types.getByRole("button")).toHaveCount(model === "moss" ? 3 : 2);
    await expect(types.getByRole("button", { pressed: true })).toHaveText(model === "moss" ? "Character" : "Object");
    if (model === "moss") {
      await types.getByRole("button", { name: "Set type to Object", exact: true }).click();
      expect((await selectedRegion())?.label).toBe("object");
      await types.getByRole("button", { name: "Set type to Character", exact: true }).click();
      expect((await selectedRegion())?.label).toBe("character");
    }
    await types.getByRole("button", { name: "Set type to Text", exact: true }).click();
    expect((await selectedRegion())?.type).toBe("text");
    await expect(details.getByRole("textbox", { name: "Literal text", exact: true })).toBeVisible();
    await types.getByRole("button", { name: "Set type to Object", exact: true }).click();
    expect((await selectedRegion())?.type).toBe("obj");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(types.getByRole("button", { name: "Set type to Text", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await types.getByRole("button", { name: "Set type to Object", exact: true }).click();
    await details
      .getByRole("textbox", { name: model === "moss" ? "Caption" : "Description", exact: true })
      .fill(
        "A very long element name that should truncate without displacing the redraw and reorder actions".repeat(3),
      );
    await parent.selectOption("window");
    expect((await selectedRegion())?.parent_id).toBe("window");
    await expect(details.getByRole("button", { name: "Move region up", exact: true })).toBeDisabled();
    await expect(details.getByRole("button", { name: "Move region down", exact: true })).toBeDisabled();
    await parent.selectOption("");
    expect((await selectedRegion())?.parent_id).toBeNull();
    for (const width of [1674, 600]) {
      await page.setViewportSize({ width, height: 1010 });
      const heading = details.locator(".region-detail-heading");
      const centers = await heading.locator("h2, button").evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return rect.y + rect.height / 2;
        }),
      );
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
      expect(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(
        await details.locator(".region-metadata").evaluate((element) => element.getBoundingClientRect().height),
      ).toBeLessThanOrEqual(60);
      expect(await details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(heading.getByRole("button", { name: "Redraw", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`compact-region-details-${width}.png`) });
    }
    await details.getByRole("button", { name: "Redraw", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Draw a replacement box");
  });

  for (const previousTool of ["Select", "Pan", "Object", "Text"]) {
    test(`${model}: adding a child from ${previousTool} immediately draws its own box`, async ({ page }) => {
      await openEditor(page, model);
      const original = await readState(page);
      await page.getByRole("button", { name: previousTool, exact: true }).click();
      await page.getByRole("button", { name: "Add child to region 2", exact: true }).click();
      const childId = (await readState(page)).selected_region_id;
      await expect(page.getByRole("status")).toContainText("Draw a box for the selected region");
      const frame = await page.locator("svg > g > rect").first().boundingBox();
      expect(frame).not.toBeNull();
      if (!frame) return;
      // Draw over the parent: it must place the child, not move or select the parent.
      await page.mouse.move(frame.x + frame.width * 0.3, frame.y + frame.height * 0.25);
      await page.mouse.down();
      await page.mouse.move(frame.x + frame.width * 0.4, frame.y + frame.height * 0.4, { steps: 8 });
      await page.mouse.up();
      const placed = await readState(page);
      expect(placed.elements).toHaveLength(original.elements.length + 1);
      expect(placed.selected_region_id).toBe(childId);
      const child = placed.elements.find((region) => region.id === childId);
      expect(child?.parent_id).toBe("reader");
      expect(child?.bbox).not.toBeNull();
      expect(child?.bbox).not.toEqual(original.elements.find((region) => region.id === "reader")?.bbox);
      expect(placed.elements.filter((region) => region.id !== childId)).toEqual(original.elements);
      await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      expect((await readState(page)).elements.find((region) => region.id === childId)?.bbox).toBeNull();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      expect((await readState(page)).elements).toEqual(original.elements);
    });
  }

  test(`${model}: new children stay unplaced until their own box is drawn`, async ({ page }) => {
    await openEditor(page, model);
    const original = await readState(page);
    await page.getByRole("button", { name: "Add child to region 2", exact: true }).click();
    const created = await readState(page);
    const childId = created.selected_region_id;
    expect(created.elements.find((region) => region.id === childId)?.bbox).toBeNull();
    expect(created.elements.find((region) => region.id === childId)?.parent_id).toBe("reader");
    await expect(page.locator("svg .region")).toHaveCount(9);
    await expect(page.locator("svg .selection-outline, svg .resize-handle")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "To selection", exact: true })).toBeDisabled();
    await page
      .getByRole("textbox", { name: model === "moss" ? "Caption" : "Description", exact: true })
      .fill("Unplaced sleeve");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await page
      .getByRole("button", { name: model === "moss" ? "Open MOSS editor" : "Open Ideogram editor", exact: true })
      .click();
    expect((await readState(page)).elements.find((region) => region.id === childId)?.bbox).toBeNull();
    await page.getByRole("button", { name: "Import and export options" }).click();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("region", { name: "Prompt JSON preview" });
    if (model === "moss") {
      await expect(preview.getByRole("alert")).toContainText('Draw a bounding box for "Unplaced sleeve"');
      await expect(preview.locator("pre")).toHaveCount(0);
    } else {
      const prompt = IdeogramV4JsonPromptSchema.parse(JSON.parse(await preview.locator("pre").innerText()));
      expect(prompt.compositional_deconstruction.elements[2].desc).toBe("Unplaced sleeve");
      expect(prompt.compositional_deconstruction.elements[2].bbox).toBeUndefined();
    }
    await page.getByRole("button", { name: "Close preview", exact: true }).click();
    await page.getByRole("button", { name: "Draw box for region 3", exact: true }).click();
    await page.keyboard.press("Escape");
    expect((await readState(page)).elements.find((region) => region.id === childId)?.bbox).toBeNull();
    await drawSelectedRegion(page);
    const placed = await readState(page);
    expect(placed.elements).toHaveLength(10);
    expect(placed.elements.find((region) => region.id === childId)?.bbox).not.toBeNull();
    expect(placed.elements.find((region) => region.id === childId)?.bbox).not.toEqual(original.elements[1].bbox);
    expect(placed.elements.find((region) => region.id === "reader")?.bbox).toEqual(original.elements[1].bbox);
    await expect(page.locator("svg .region")).toHaveCount(10);
    await expect(page.getByRole("button", { name: "Zoom to region 3", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await readState(page)).elements.find((region) => region.id === childId)?.bbox).toBeNull();
    await expect(page.locator("svg .region")).toHaveCount(9);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await readState(page)).elements.find((region) => region.id === childId)?.bbox).toEqual(
      placed.elements.find((region) => region.id === childId)?.bbox,
    );
  });

  test(`${model}: nests subtrees, creates children, exports native JSON and restores deleted hierarchies`, async ({
    page,
  }, testInfo) => {
    await openEditor(page, model);
    const original = await readState(page);
    const target = page.locator('.region-row[data-region-id="window"]');
    const bounds = await target.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    await page.getByRole("button", { name: "Drag to reorder region 2", exact: true }).dragTo(target, {
      targetPosition: { x: 120, y: bounds.height / 2 },
    });
    let state = await readState(page);
    expect(state.elements.find((region) => region.id === "reader")?.parent_id).toBe("window");
    expect(state.elements.find((region) => region.id === "reader")?.bbox).toEqual(original.elements[1].bbox);
    await expect(page.locator(".region-item.active")).toHaveAttribute("data-depth", "1");
    const parent = page.getByRole("combobox", { name: "Parent", exact: true });
    await expect(parent.locator('option[value="reader"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Add child to region 2", exact: true }).click();
    state = await readState(page);
    const childId = state.selected_region_id;
    expect(childId).not.toBeNull();
    expect(state.elements.find((region) => region.id === childId)?.parent_id).toBe("reader");
    await expect(page.locator(".region-item.active")).toHaveAttribute("data-depth", "2");
    await page
      .getByRole("textbox", { name: model === "moss" ? "Caption" : "Description", exact: true })
      .fill("A small nested detail");
    await drawSelectedRegion(page);
    await parent.selectOption("");
    expect((await readState(page)).elements.find((region) => region.id === childId)?.parent_id).toBeNull();
    await parent.selectOption("reader");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await page
      .getByRole("button", { name: model === "moss" ? "Open MOSS editor" : "Open Ideogram editor", exact: true })
      .click();
    await expect(page.locator(".region-item.active")).toHaveAttribute("data-depth", "2");
    await page.screenshot({ path: testInfo.outputPath("nested-regions.png") });
    await page.getByRole("button", { name: "Import and export options" }).click();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("region", { name: "Prompt JSON preview" });
    await expect(preview).toContainText("A small nested detail");
    await expect(preview).not.toContainText("parent_id");
    await expect(preview).toContainText(model === "moss" ? '"items"' : '"compositional_deconstruction"');
    await page.getByRole("button", { name: "Close preview", exact: true }).click();
    const windowRow = page.locator('.region-row[data-region-id="window"]');
    await windowRow.locator(".region-select").click();
    await expect(parent.locator(`option[value="${childId}"]`)).toHaveCount(0);
    await windowRow.getByRole("button", { name: "Delete region 1", exact: true }).click();
    await expect(page.locator(".region-item")).toHaveCount(7);
    expect((await readState(page)).elements.some((region) => region.id === childId || region.id === "reader")).toBe(
      false,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".region-item")).toHaveCount(10);
    expect((await readState(page)).elements.find((region) => region.id === childId)?.parent_id).toBe("reader");
  });

  test(`${model}: compact rows expose actions and dragging promotes entire subtrees to root`, async ({
    page,
  }, testInfo) => {
    await openEditor(page, model);
    const windowRow = page.locator('.region-row[data-region-id="window"]');
    await windowRow.getByRole("button", { name: "Zoom to region 1", exact: true }).click();
    expect((await readState(page)).selected_region_id).toBe("window");
    await expect(page.locator(".zoom-controls span")).not.toHaveText("100%");
    // Child creation works directly from an unselected row.
    const readerRow = page.locator('.region-row[data-region-id="reader"]');
    await readerRow.getByRole("button", { name: "Add child to region 2", exact: true }).click();
    const childId = (await readState(page)).selected_region_id;
    expect(childId).not.toBeNull();
    await readerRow.locator(".region-select").click();
    await page.getByRole("combobox", { name: "Parent", exact: true }).selectOption("window");
    const dragReader = () => readerRow.locator(".drag-handle");
    await dragReader().dragTo(page.getByRole("group", { name: "Root level, first position", exact: true }));
    let state = await readState(page);
    expect(state.elements[0].id).toBe("reader");
    expect(state.elements[0].parent_id).toBeNull();
    expect(state.elements[1].id).toBe(childId);
    expect(state.elements[1].parent_id).toBe("reader");

    await page.getByRole("combobox", { name: "Parent", exact: true }).selectOption("window");
    await dragReader().dragTo(page.getByRole("group", { name: "Root level, last position", exact: true }));
    state = await readState(page);
    expect(state.elements.at(-2)?.id).toBe("reader");
    expect(state.elements.at(-2)?.parent_id).toBeNull();
    expect(state.elements.at(-1)?.id).toBe(childId);

    await page.getByRole("combobox", { name: "Parent", exact: true }).selectOption("window");
    // The indentation gutter is a root drop surface even beside the moving row itself.
    await dragReader().dragTo(readerRow.locator(".."), { targetPosition: { x: 2, y: 2 } });
    state = await readState(page);
    expect(state.elements[0].id).toBe("reader");
    expect(state.elements[0].parent_id).toBeNull();
    expect(state.elements[1].parent_id).toBe("reader");
    await expect(page.locator(".region-item .region-details")).toHaveCount(0);
    const rowHeights = await page
      .locator(".region-row")
      .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    expect(rowHeights.every((height) => height <= 28)).toBe(true);
    await expect(readerRow.getByRole("checkbox")).toBeVisible();
    await expect(readerRow.getByRole("button", { name: "Zoom to region 1", exact: true })).toBeVisible();
    await expect(readerRow.getByRole("button", { name: "Add child to region 1", exact: true })).toBeVisible();
    await expect(readerRow.getByRole("button", { name: "Delete region 1", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("compact-outline.png") });
    await page.setViewportSize({ width: 600, height: 800 });
    expect(
      await page.locator(".region-row").evaluateAll((rows) => rows.every((row) => row.scrollWidth <= row.clientWidth)),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("compact-outline-narrow.png") });
  });

  test(`${model}: edits, reorders, bulk deletes, and restores the actual node state`, async ({ page }) => {
    await openEditor(page, model);
    const caption = page.getByRole("textbox", { name: model === "moss" ? "Caption" : "Description", exact: true });
    await caption.fill("A reader in a green coat.");
    await page.getByRole("button", { name: "Move region down" }).click();
    const moved = await readState(page);
    expect(moved.elements[2].id).toBe("reader");
    expect(moved.elements[2].desc).toBe("A reader in a green coat.");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await readState(page)).elements[1].id).toBe("reader");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(caption).toHaveValue("A reader in a long blue coat, holding an open book");
    await page.getByRole("checkbox", { name: "Select region 1 for bulk actions" }).check();
    await page.getByRole("checkbox", { name: "Select region 3 for bulk actions" }).check();
    await page.getByRole("button", { name: "Delete selected (2)" }).click();
    await expect(page.locator(".region-item")).toHaveCount(7);
    await page.getByRole("checkbox", { name: "Select all regions" }).check();
    await page.getByRole("button", { name: "Delete selected (7)" }).click();
    await expect(page.locator(".region-item")).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".region-item")).toHaveCount(7);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await readState(page)).elements).toEqual([]);
  });
}

test("Focus isolates boxes, selection zoom is explicit, and labels stay uncluttered", async ({ page }) => {
  await openEditor(page);
  await expect(page.locator("svg .region")).toHaveCount(9);
  await expect(page.locator("svg .region-label")).toHaveCount(1);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator("svg .region")).toHaveCount(1);
  await page.getByRole("button", { name: "To selection", exact: true }).click();
  await expect(page.locator(".zoom-controls span")).not.toHaveText("100%");
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect(page.locator(".zoom-controls span")).toHaveText("100%");
  await page.getByRole("button", { name: "Hide boxes", exact: true }).click();
  await expect(page.locator("svg .region")).toHaveCount(0);
  await page.getByRole("button", { name: "Show boxes", exact: true }).click();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator("svg .region")).toHaveCount(9);
  await page.keyboard.press("Escape");
  expect((await readState(page)).selected_region_id).toBeNull();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator("svg .region")).toHaveCount(0);
  await page.locator(".region-item .region-select").first().click();
  await expect(page.locator("svg .region")).toHaveCount(1);
});

test("drawing returns to Select; moving is one undo step and Escape cancels a drag", async ({ page }) => {
  await openEditor(page, "moss", true);
  const frame = await page.locator("svg > g > rect").first().boundingBox();
  expect(frame).not.toBeNull();
  if (!frame) return;
  await page.getByRole("button", { name: "Object", exact: true }).click();
  await page.mouse.move(frame.x + frame.width * 0.15, frame.y + frame.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.45, frame.y + frame.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".region-item")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  const created = (await readState(page)).elements[0];
  expect(created.desc).toBe("");
  const box = await page.locator(".region-rect").boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 60, center.y + 40, { steps: 8 });
  await page.mouse.up();
  expect((await readState(page)).elements[0].bbox).not.toEqual(created.bbox);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await readState(page)).elements[0].bbox).toEqual(created.bbox);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 80, center.y + 50, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await readState(page)).elements[0].bbox).toEqual(created.bbox);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".region-item")).toHaveCount(0);
});

test("native text undo and long caption expansion preserve editing", async ({ page }) => {
  await openEditor(page);
  const caption = page.getByRole("textbox", { name: "Caption", exact: true });
  const original = await caption.inputValue();
  await caption.focus();
  await caption.press("End");
  await page.keyboard.type(" with glasses");
  await caption.press("Control+z");
  await expect(caption).toHaveValue(original);
  const longText = "A detailed description of the reader and their book. ".repeat(30);
  await caption.fill(longText);
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  await expect(page.locator(".text-field.expanded")).toBeVisible();
  await expect(caption).toHaveValue(longText);
  await caption.focus();
  await caption.press("Escape");
  await expect(page.locator(".text-field.expanded")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await readState(page)).elements[1].desc).toBe(longText);
});

test("scene captions resize past the automatic height limit and retain their size while editing", async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Scene & style", exact: true }).click();
  const caption = page.getByRole("textbox", { name: "Scene caption", exact: true });
  const longText = "A detailed description of the scene and its visual style. ".repeat(60);
  await caption.fill(longText);
  const before = await caption.boundingBox();
  expect(before).not.toBeNull();
  if (!before) return;
  expect(before.height).toBe(320);
  const targetHeight = 700;
  await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width - 3, before.y + targetHeight - 3, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await caption.boundingBox())?.height).toBe(targetHeight);
  await caption.press("Control+End");
  await caption.pressSequentially(" More detail.");
  expect((await caption.boundingBox())?.height).toBe(targetHeight);
  await expect(caption).toHaveValue(`${longText} More detail.`);
  await expect(page.getByRole("textbox", { name: "Add a tag", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("resized-scene-caption.png") });
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  await caption.press("Escape");
  expect((await caption.boundingBox())?.height).toBe(targetHeight);
  expect((await readState(page)).high_level_description).toBe(`${longText} More detail.`);
});

test("numeric fields accept intermediate edits and validate on commit", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  const width = page.getByRole("spinbutton", { name: "Width", exact: true });
  await width.fill("");
  expect((await readState(page)).width).toBe(1024);
  await width.fill("1536");
  expect((await readState(page)).width).toBe(1024);
  await width.press("Enter");
  expect((await readState(page)).width).toBe(1536);
  await width.fill("0");
  await width.press("Tab");
  await expect(width).toHaveAttribute("aria-invalid", "true");
  expect((await readState(page)).width).toBe(1536);
});

test("drag reordering retains selection and stable region colors", async ({ page }) => {
  await openEditor(page);
  const color = await page.locator('.region-row[data-region-id="reader"]').locator("..").getAttribute("style");
  await page
    .getByRole("button", { name: "Drag to reorder region 2", exact: true })
    .dragTo(page.locator('.region-row[data-region-id="window"]'), { targetPosition: { x: 20, y: 2 } });
  const state = await readState(page);
  expect(state.elements[0].id).toBe("reader");
  expect(state.selected_region_id).toBe("reader");
  expect(await page.locator('.region-row[data-region-id="reader"]').locator("..").getAttribute("style")).toBe(color);
});

test("sidebar resizing persists and narrow layouts have no horizontal overflow", async ({ page }) => {
  await openEditor(page);
  const resizer = page.getByRole("button", { name: "Resize sidebar; use left and right arrow keys" });
  const originalWidth = await page
    .locator(".editor-sidebar")
    .evaluate((element) => element.getBoundingClientRect().width);
  await resizer.focus();
  await resizer.press("ArrowLeft");
  const width = await page.locator(".editor-sidebar").evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBe(originalWidth + 20);
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.locator(".editor-sidebar").evaluate((element) => element.getBoundingClientRect().width)).toBe(
    width,
  );
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.getByRole("textbox", { name: "Caption", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Hide panel", exact: true }).click();
  await expect(page.locator(".editor-sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit panel", exact: true }).click();
  await expect(page.locator(".editor-sidebar")).toBeVisible();
});

test("reference uploads and image matching preserve the exact source ratio", async ({ page }, testInfo) => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="803" height="397"><rect width="803" height="397" fill="#446688"/></svg>';
  await page.route("**/neriss_comfynodes/editor/reference_image**", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({ json: { path: "preview-reference.svg", name: "reference.svg", width: 803, height: 397 } });
    else await route.fulfill({ contentType: "image/svg+xml", body: svg });
  });
  await openEditor(page);
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "reference.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(page.getByRole("button", { name: "Match size", exact: true })).toBeEnabled();
  const uploaded = await readState(page);
  expect([uploaded.width, uploaded.height]).toEqual([803, 397]);
  expect(uploaded.megapixels).toBe((803 * 397) / 1_000_000);
  const width = page.getByRole("spinbutton", { name: "Width", exact: true });
  await width.fill("1024");
  await width.press("Enter");
  await page.getByRole("button", { name: "Match size", exact: true }).click();
  const matched = await readState(page);
  expect([matched.width, matched.height]).toEqual([803, 397]);
  // Measure the image viewport without the frame's one-pixel border.
  const image = await page.locator("svg image").boundingBox();
  expect(image).not.toBeNull();
  if (image) expect(image.width / image.height).toBeCloseTo(803 / 397, 5);
  const palette = await page.getByRole("toolbar", { name: "Canvas tools" }).boundingBox();
  if (image && palette) expect(image.x).toBeGreaterThan(palette.x + palette.width);
  await page.screenshot({ path: testInfo.outputPath("matched-reference.png") });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await readState(page)).reference_image_path).toBe("preview-reference.svg");
  expect((await readState(page)).width).toBe(1024);
});

test("the open editor captures background shortcuts and image paste, then releases them on close", async ({ page }) => {
  await page.addInitScript(() => {
    for (const type of ["keydown", "keyup", "keypress", "paste", "copy", "cut"]) {
      document.addEventListener(type, () => {
        const root = document.documentElement;
        root.dataset.hostEvents = `${root.dataset.hostEvents ?? ""}${type},`;
      });
    }
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="913" height="607"/>';
  let uploads = 0;
  await page.route("**/neriss_comfynodes/editor/reference_image**", (route) => {
    if (route.request().method() === "POST") uploads += 1;
    return route.fulfill(
      route.request().method() === "POST"
        ? { json: { path: "captured.svg", name: "captured.svg", width: 913, height: 607 } }
        : { contentType: "image/svg+xml", body: svg },
    );
  });
  await openEditor(page);
  await page.evaluate(() => {
    const graph = document.createElement("canvas");
    graph.id = "graph-canvas";
    graph.tabIndex = 0;
    document.body.append(graph);
    graph.focus();
  });
  await expect(page.getByRole("dialog")).toBeFocused();
  // Events can still target the graph after a host handler or an async focus change.
  await page.locator("#graph-canvas").dispatchEvent("keydown", { key: "o", bubbles: true, cancelable: true });
  await expect(page.getByRole("button", { name: "Object", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator("#graph-canvas").dispatchEvent("keyup", { key: "o", bubbles: true, cancelable: true });
  await page.locator("#graph-canvas").dispatchEvent("keypress", { key: "o", bubbles: true, cancelable: true });
  await page.locator("#graph-canvas").evaluate((element, image) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([image], "captured.svg", { type: "image/svg+xml" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, svg);
  await expect.poll(async () => (await readState(page)).reference_image_path).toBe("captured.svg");
  expect(uploads).toBe(1);
  expect((await readState(page)).elements).toHaveLength(9);
  expect(await page.locator("html").getAttribute("data-host-events")).toBeNull();
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await page.locator("#graph-canvas").focus();
  await page.keyboard.press("o");
  await page.locator("#graph-canvas").dispatchEvent("paste", { bubbles: true, cancelable: true });
  await expect(page.locator("html")).toHaveAttribute("data-host-events", "keydown,keypress,keyup,paste,");
  expect(uploads).toBe(1);
  await page.getByRole("button", { name: "Open MOSS editor", exact: true }).click();
  await page.evaluate(() => delete document.documentElement.dataset.hostEvents);
  await page.getByRole("dialog").focus();
  await page.keyboard.press("v");
  expect(await page.locator("html").getAttribute("data-host-events")).toBeNull();
});

test("native text clipboard editing stays inside the editor, expanded fields and native modals", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    for (const type of ["keydown", "keyup", "keypress", "paste", "copy", "cut"]) {
      document.addEventListener(type, () => {
        document.documentElement.dataset.hostEvent = type;
      });
    }
  });
  await openEditor(page);
  const field = page.locator(".region-details").getByRole("textbox", { name: "Caption", exact: true });
  await field.locator("..").getByRole("button", { name: "Expand", exact: true }).click();
  await field.fill("");
  await page.evaluate(() => navigator.clipboard.writeText("editor text"));
  await field.focus();
  await page.keyboard.press("Control+v");
  await expect(field).toHaveValue("editor text");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("editor text");
  await page.keyboard.press("Control+x");
  await expect(field).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Editor settings", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search shortcuts" });
  await page.evaluate(() => navigator.clipboard.writeText("Object"));
  await search.focus();
  await page.keyboard.press("Control+v");
  await expect(search).toHaveValue("Object");
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page.getByRole("button", { name: "Manage presets", exact: true }).click();
  const presets = page.getByRole("dialog", { name: "Manage aspect-ratio presets", exact: true });
  const name = presets.getByRole("textbox", { name: "Preset 1 name", exact: true });
  await page.evaluate(() => navigator.clipboard.writeText("Pasted preset"));
  await name.fill("");
  await name.focus();
  await page.keyboard.press("Control+v");
  await expect(name).toHaveValue("Pasted preset");
  await page.keyboard.type("!");
  await expect(name).toHaveValue("Pasted preset!");
  expect(await page.locator("html").getAttribute("data-host-event")).toBeNull();
});

test("native image paste automatically matches the canvas and is one undo step", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="913" height="607"/>';
  await page.route("**/neriss_comfynodes/editor/reference_image**", (route) =>
    route.fulfill(
      route.request().method() === "POST"
        ? { json: { path: "pasted.svg", name: "pasted.svg", width: 913, height: 607 } }
        : { contentType: "image/svg+xml", body: svg },
    ),
  );
  await openEditor(page);
  const copied = await page.evaluate(async () => {
    const image = document.createElement("canvas");
    image.width = 913;
    image.height = 607;
    const blob = await new Promise<Blob | null>((resolve) => image.toBlob(resolve, "image/png"));
    if (!blob) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  });
  expect(copied).toBe(true);
  await page.getByRole("application", { name: "Layout canvas" }).focus();
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await readState(page)).reference_image_path).toBe("pasted.svg");
  const pasted = await readState(page);
  expect([pasted.width, pasted.height]).toEqual([913, 607]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const restored = await readState(page);
  expect([restored.width, restored.height]).toEqual([1024, 1472]);
  expect(restored.reference_image_path).toBeNull();
});

test("aspect ratios use the user's saved presets and retain the megapixel target", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  const presets = page.getByRole("combobox", { name: "Aspect ratio", exact: true });
  await expect(presets).toBeEnabled();
  await expect(presets.locator("option")).toHaveText(["Custom", "My banner · 7:2", "My poster · 3:5"]);
  const before = await readState(page);
  await presets.selectOption("My banner");
  const after = await readState(page);
  expect(after.width).toBe(2304);
  expect(after.height).toBe(640);
  expect(after.megapixels).toBe(before.megapixels);
  await expect(presets).toHaveValue("My banner");
});

test("custom ratios, squared targets and the target lock keep the pixel count", async ({ page }, testInfo) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="6000"/>';
  await page.route("**/neriss_comfynodes/editor/reference_image**", (route) =>
    route.fulfill(
      route.request().method() === "POST"
        ? { json: { path: "large.svg", name: "large.svg", width: 8000, height: 6000 } }
        : { contentType: "image/svg+xml", body: svg },
    ),
  );
  await openEditor(page);
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  const ratioWidth = page.getByRole("spinbutton", { name: "Ratio width", exact: true });
  const ratioHeight = page.getByRole("spinbutton", { name: "Ratio height", exact: true });
  await ratioWidth.fill("16");
  await ratioWidth.press("Enter");
  await ratioHeight.fill("9");
  await ratioHeight.press("Enter");
  await expect(ratioWidth).toHaveValue("16");
  await expect(ratioHeight).toHaveValue("9");
  await page.getByRole("button", { name: "Squared", exact: true }).click();
  const side = page.getByRole("spinbutton", { name: "Square side", exact: true });
  await side.fill("1024");
  await side.press("Enter");
  const sized = await readState(page);
  expect([sized.width, sized.height, sized.size_mode]).toEqual([1344, 768, "squared"]);
  await expect(ratioWidth).toHaveValue("16");

  const lock = page.getByRole("button", { name: "Lock target", exact: true });
  await lock.click();
  await expect(side).toBeDisabled();
  await expect(page.getByRole("spinbutton", { name: "Width", exact: true })).toBeDisabled();
  await expect(ratioWidth).toBeEnabled();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "large.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect.poll(async () => (await readState(page)).reference_image_path).toBe("large.svg");
  const locked = await readState(page);
  expect([locked.width, locked.height, locked.megapixels, locked.target_locked]).toEqual([1152, 896, 1.048576, true]);
  await expect(ratioWidth).toHaveValue("4");
  await expect(ratioHeight).toHaveValue("3");
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  expect([(await readState(page)).width, (await readState(page)).height]).toEqual([896, 1152]);
  await page.getByRole("button", { name: "Match ratio", exact: true }).click();
  expect([(await readState(page)).width, (await readState(page)).height]).toEqual([1152, 896]);
  await page.screenshot({ path: testInfo.outputPath("canvas-controls.png") });
  await lock.click();
  await page.getByRole("button", { name: "Match size", exact: true }).click();
  const matched = await readState(page);
  expect([matched.width, matched.height]).toEqual([8000, 6000]);
});

test("preset load errors can be retried without substituting hardcoded ratios", async ({ page }) => {
  let failed = true;
  await page.route("**/neriss_comfynodes/resolution/presets", (route) =>
    route.fulfill(
      failed ? { status: 503, body: "Unavailable" } : { json: { presets: [{ name: "Recovered", x: 5, y: 4 }] } },
    ),
  );
  await page.goto("/preview/index.html");
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  const presets = page.getByRole("combobox", { name: "Aspect ratio", exact: true });
  await expect(page.getByRole("alert")).toContainText("Unavailable");
  await expect(presets).toBeDisabled();
  await expect(presets.locator("option")).toHaveCount(1);
  failed = false;
  await page.getByRole("button", { name: "Retry loading presets", exact: true }).click();
  await expect(presets).toBeEnabled();
  await expect(presets.locator("option")).toHaveText(["Custom", "Recovered · 5:4"]);
});

test("selection remains visible while hovering and the canvas has no top toolbar strip", async ({ page }, testInfo) => {
  await openEditor(page);
  const canvas = await page.getByRole("application", { name: "Layout canvas" }).boundingBox();
  const dialog = await page.getByRole("dialog").boundingBox();
  expect(canvas?.y).toBe(dialog?.y);
  await expect(page.locator(".region.selected")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".region.selected .region-label")).toContainText("02 · Selected ·");
  await expect(page.locator(".region-item.active .region-select")).toHaveAttribute("aria-pressed", "true");
  const windowRow = page.locator('.region-row[data-region-id="window"] .region-select');
  await windowRow.hover();
  await expect(page.locator(".region.selected .region-label")).toContainText("02 · Selected ·");
  await windowRow.click();
  await expect(windowRow).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".region.selected .region-label")).toContainText("01 · Selected ·");
  expect((await readState(page)).selected_region_id).toBe("window");
  await page.screenshot({ path: testInfo.outputPath("selected-region.png") });
});

test("deletion clears selection without overlays, moving the canvas, or reopening the panel", async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Hide panel", exact: true }).click();
  const canvas = page.getByRole("application", { name: "Layout canvas" });
  const frame = page.locator("svg > g > rect").first();
  const before = await frame.boundingBox();
  await canvas.focus();
  await page.keyboard.press("Delete");
  await expect(page.locator(".region.selected")).toHaveCount(0);
  await expect(page.locator(".selection-outline, .resize-handle")).toHaveCount(0);
  await expect(page.locator(".editor-sidebar")).toHaveCount(0);
  expect((await readState(page)).selected_region_id).toBeNull();
  expect(await frame.boundingBox()).toEqual(before);
  await expect(page.locator(".status-message")).toContainText("Deleted 1 region");
  await expect(canvas).toHaveCSS("box-shadow", "none");
  await expect(page.locator(".editor-toast")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("after-delete.png") });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await readState(page)).selected_region_id).toBe("reader");
  await expect(page.locator(".region.selected")).toHaveCount(1);
});

for (const model of ["moss", "ideogram"] satisfies EditorModel[]) {
  test(`${model}: import/export opens on hover beside its icon and stays open across the gap`, async ({
    page,
  }, testInfo) => {
    await openEditor(page, model);
    const trigger = page.getByRole("button", { name: "Import and export options", exact: true });
    const flyout = page.getByRole("group", { name: "Import and export actions", exact: true });
    await expect(flyout).toHaveCount(0);
    await trigger.hover();
    await expect(flyout).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const labels = [
      "Paste JSON",
      ...(model === "ideogram" ? ["Paste layout", "Paste style"] : []),
      "Copy JSON",
      "Preview",
    ];
    await expect(flyout.getByRole("button")).toHaveCount(labels.length);
    const icons = flyout.locator("svg.file-action-icon[aria-hidden='true']");
    await expect(icons).toHaveCount(labels.length);
    for (const icon of await icons.all()) {
      await expect(icon).toHaveCSS("fill", "none");
      await expect(icon).toHaveCSS("stroke", await icon.evaluate((element) => getComputedStyle(element).color));
    }
    for (const label of labels) await expect(flyout.getByRole("button", { name: label, exact: true })).toBeVisible();
    const icon = await trigger.boundingBox();
    const menu = await flyout.boundingBox();
    expect(icon).not.toBeNull();
    expect(menu).not.toBeNull();
    if (!icon || !menu) return;
    expect(menu.x - (icon.x + icon.width)).toBeGreaterThanOrEqual(8);
    expect(menu.x - (icon.x + icon.width)).toBeLessThanOrEqual(12);
    expect(Math.abs(menu.y + menu.height / 2 - (icon.y + icon.height / 2))).toBeLessThan(1);
    for (const button of await flyout.getByRole("button").all()) {
      expect((await button.boundingBox())?.height).toBeLessThanOrEqual(34);
    }
    await page.mouse.move(icon.x + icon.width + 5, icon.y + icon.height / 2, { steps: 5 });
    await expect(flyout).toBeVisible();
    await flyout.getByRole("button", { name: "Preview", exact: true }).hover();
    await expect(flyout).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("import-export-hover.png"),
      clip: {
        x: 0,
        y: 0,
        width: Math.ceil(menu.x + menu.width + 16),
        height: Math.ceil(Math.max(menu.y + menu.height + 16, icon.y + icon.height + 50)),
      },
    });
    await page.getByRole("button", { name: "Select", exact: true }).hover();
    await expect(flyout).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.hover();
    await flyout.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("region", { name: "Prompt JSON preview" })).toBeVisible();
    await expect(flyout).toHaveCount(0);
  });
}

test("import/export supports keyboard focus, Escape and opening again with ArrowDown", async ({ page }) => {
  await openEditor(page);
  const trigger = page.getByRole("button", { name: "Import and export options", exact: true });
  const flyout = page.getByRole("group", { name: "Import and export actions", exact: true });
  await trigger.focus();
  await expect(flyout).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(flyout.getByRole("button", { name: "Paste JSON", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(flyout).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(flyout.getByRole("button", { name: "Paste JSON", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Editor settings", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close editor", exact: true })).toBeFocused();
  await expect(flyout).toHaveCount(0);
});

test.describe("touch import/export", () => {
  test.use({ hasTouch: true });
  test("tapping opens the actions beside the icon above the mobile sidebar and an outside tap closes them", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openEditor(page);
    const trigger = page.getByRole("button", { name: "Import and export options", exact: true });
    const flyout = page.getByRole("group", { name: "Import and export actions", exact: true });
    await trigger.tap();
    await expect(flyout).toBeVisible();
    await flyout.getByRole("button", { name: "Preview", exact: true }).tap();
    await expect(page.getByRole("region", { name: "Prompt JSON preview" })).toBeVisible();
    await page.getByRole("button", { name: "Close preview", exact: true }).tap();
    await trigger.tap();
    await expect(flyout).toBeVisible();
    await page.getByRole("button", { name: "Select", exact: true }).tap();
    await expect(flyout).toHaveCount(0);
  });
});

test("the sidebar starts with tabs and file actions remain available with it hidden", async ({ page }) => {
  await openEditor(page);
  const sidebar = await page.locator(".editor-sidebar").boundingBox();
  const tabs = await page.getByRole("navigation", { name: "Editor sections" }).boundingBox();
  expect(tabs?.y).toBe(sidebar?.y);
  await page.getByRole("button", { name: "Hide panel", exact: true }).click();
  await page.getByRole("button", { name: "Import and export options" }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("region", { name: "Prompt JSON preview" })).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("tags are explicitly added, deduplicated, removed, and undoable", async ({ page }, testInfo) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Scene & style", exact: true }).click();
  const before = (await readState(page)).moss_meta;
  const input = page.getByRole("textbox", { name: "Add a tag", exact: true });
  await input.fill("  warm tones  ");
  expect((await readState(page)).moss_meta).toEqual(before);
  await input.press("Enter");
  await expect(input).toHaveValue("");
  expect((await readState(page)).moss_meta).toEqual([...before, "warm tones"]);
  await input.fill("warm tones");
  await page.getByRole("button", { name: "Add tag", exact: true }).click();
  expect((await readState(page)).moss_meta).toEqual([...before, "warm tones"]);
  await page.getByRole("button", { name: "Remove tag warm tones", exact: true }).click();
  expect((await readState(page)).moss_meta).toEqual(before);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("list", { name: "Saved tags" })).toContainText("warm tones");
  await page.screenshot({ path: testInfo.outputPath("tag-chips.png") });
});

test("palette colors float above the sidebar, save on outside clicks, and persist favorites", async ({
  page,
}, testInfo) => {
  let library: unknown = { favorites: ["#FF8800"], recent: [] };
  await page.route("**/neriss_comfynodes/editor/colors", (route) => {
    if (route.request().method() === "POST") library = route.request().postDataJSON();
    return route.fulfill({ json: library });
  });
  await openEditor(page);
  const palette = async () => (await readState(page)).elements.find((region) => region.id === "reader")?.color_palette;
  const before = (await palette()) ?? [];
  await page.getByRole("button", { name: "Add region palette color", exact: true }).click();
  const picker = page.getByRole("group", { name: "Edit region palette color", exact: false });
  const hex = picker.getByRole("textbox", { name: "Hex color", exact: true });
  await expect(picker).toBeInViewport({ ratio: 1 });
  await expect(hex).toBeFocused();
  await hex.fill(" #12ab34 ");
  expect(await palette()).toEqual([...before, "#12AB34"]);
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => library).toEqual({ favorites: ["#FF8800"], recent: ["#12AB34"] });

  await page.getByRole("button", { name: "Add region palette color", exact: true }).click();
  expect(await palette()).toEqual([...before, "#12AB34", "#12AB34"]);
  await hex.fill("abc");
  await page.getByRole("heading", { name: "Regions 9", exact: true }).click();
  await expect(picker).toBeHidden();
  expect(await palette()).toEqual([...before, "#12AB34", "#AABBCC"]);
  await expect.poll(() => library).toEqual({ favorites: ["#FF8800"], recent: ["#AABBCC", "#12AB34"] });

  await page.getByRole("button", { name: "Region palette color 2: #AABBCC", exact: true }).click();
  await picker.getByRole("button", { name: "Use favorite color #FF8800", exact: true }).click();
  expect(await palette()).toEqual([...before, "#12AB34", "#FF8800"]);
  await expect(picker.getByRole("button", { name: "Remove from favorites", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await picker.getByRole("button", { name: "Use recent color #12AB34", exact: true }).click();
  await picker.getByRole("button", { name: "Add to favorites", exact: true }).click();
  await expect.poll(() => library).toEqual({ favorites: ["#FF8800", "#12AB34"], recent: ["#AABBCC", "#12AB34"] });

  const area = await picker.getByRole("slider", { name: "Saturation and brightness", exact: true }).boundingBox();
  expect(area).not.toBeNull();
  if (!area) return;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x - 20, area.y + area.height + 20, { steps: 6 });
  await page.mouse.up();
  expect(await palette()).toEqual([...before, "#12AB34", "#000000"]);
  await expect(hex).toHaveValue("#000000");
  await page.screenshot({ path: testInfo.outputPath("color-picker.png") });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await palette()).toEqual([...before, "#12AB34", "#12AB34"]);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("rgb(166, 73, 63)"));
  await page.getByRole("button", { name: "Region palette color 2: #12AB34", exact: true }).click();
  await expect(hex).toBeFocused();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(hex).toHaveValue("#A6493F");
  expect(await palette()).toEqual([...before, "#12AB34", "#A6493F"]);
  await hex.fill("166, 73, 6");
  expect(await palette()).toEqual([...before, "#12AB34", "#A6493F"]);
  await hex.press("Enter");
  await expect(hex).toHaveValue("#A64906");
  expect(await palette()).toEqual([...before, "#12AB34", "#A64906"]);
});

test("image fitting is immediately accessible and persisted independently of canvas size", async ({
  page,
}, testInfo) => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#cc8844"/></svg>';
  await page.route("**/neriss_comfynodes/editor/reference_image**", (route) =>
    route.fulfill(
      route.request().method() === "POST"
        ? { json: { path: "fit.svg", name: "fit.svg", width: 800, height: 400 } }
        : { contentType: "image/svg+xml", body: svg },
    ),
  );
  await openEditor(page);
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "fit.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  const fitting = page.getByRole("combobox", { name: "Image fitting", exact: true });
  await expect(fitting).toHaveValue("stretch");
  const width = page.getByRole("spinbutton", { name: "Width", exact: true });
  await width.fill("400");
  await width.press("Enter");
  await expect(page.locator("svg image")).toHaveAttribute("preserveAspectRatio", "none");
  await expect(fitting).toBeInViewport();
  await expect(page.getByRole("button", { name: "Manage presets", exact: true })).toBeInViewport();
  await fitting.selectOption("contain");
  expect((await readState(page)).reference_image_fit).toBe("contain");
  await expect(page.locator("svg image")).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(fitting).toHaveValue("contain");
  await fitting.selectOption("stretch");
  const stretched = await readState(page);
  expect([stretched.width, stretched.height]).toEqual([400, 400]);
  await page.screenshot({ path: testInfo.outputPath("image-fitting.png") });
});

test("AR presets can be edited and saved from Canvas, with failed saves retaining drafts", async ({ page }) => {
  await openEditor(page);
  let saved = [
    { name: "My banner", x: 7, y: 2 },
    { name: "My poster", x: 3, y: 5 },
  ];
  let failSave = true;
  await page.route("**/neriss_comfynodes/resolution/presets", async (route) => {
    if (route.request().method() === "POST") {
      if (failSave) {
        await route.fulfill({ status: 503, body: "Could not save presets" });
        return;
      }
      const payload: unknown = route.request().postDataJSON();
      const parsed = z.object({ presets: z.array(resolutionPresetSchema) }).parse(payload);
      saved = parsed.presets;
    }
    await route.fulfill({ json: { presets: saved } });
  });
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page.getByRole("button", { name: "Manage presets", exact: true }).click();
  await page.getByRole("textbox", { name: "Preset 1 name", exact: true }).fill("Custom wide");
  await page.getByRole("button", { name: "Delete preset 2", exact: true }).click();
  await page.getByRole("button", { name: "Add preset", exact: true }).click();
  await page.getByRole("textbox", { name: "Preset 2 name", exact: true }).fill("New portrait");
  await page.getByRole("spinbutton", { name: "Preset 2 height", exact: true }).fill("2");
  await page.getByRole("button", { name: "Move preset 2 up", exact: true }).click();
  await page.getByRole("button", { name: "Save presets", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save presets");
  await expect(page.getByRole("textbox", { name: "Preset 1 name", exact: true })).toHaveValue("New portrait");
  failSave = false;
  await page.getByRole("button", { name: "Save presets", exact: true }).click();
  const ratios = page.getByRole("combobox", { name: "Aspect ratio", exact: true });
  await expect(ratios.locator("option")).toHaveText(["Custom", "New portrait · 1:2", "Custom wide · 7:2"]);
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await ratios.selectOption("New portrait");
  expect((await readState(page)).height).toBeGreaterThan((await readState(page)).width);
});

test("preset management is a modal with contained keyboard focus and cancel restores the sidebar", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Manage presets", exact: true });
  const ratio = page.getByRole("combobox", { name: "Aspect ratio", exact: true });
  const before = await ratio.boundingBox();
  const state = await readState(page);
  await trigger.click();
  const modal = page.getByRole("dialog", { name: "Manage aspect-ratio presets", exact: true });
  await expect(modal).toBeVisible();
  expect(await modal.evaluate((element) => element.matches(":modal"))).toBe(true);
  expect(await ratio.boundingBox()).toEqual(before);
  const close = modal.getByRole("button", { name: "Close preset manager", exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(modal.getByRole("button", { name: "Save presets", exact: true })).toBeFocused();
  await page.keyboard.press("Delete");
  expect((await readState(page)).elements).toEqual(state.elements);
  await modal.getByRole("textbox", { name: "Preset 1 name", exact: true }).fill("Discard this draft");
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(ratio.locator("option")).toHaveText(["Custom", "My banner · 7:2", "My poster · 3:5"]);
  await trigger.click();
  await expect(modal.getByRole("textbox", { name: "Preset 1 name", exact: true })).toHaveValue("My banner");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(trigger).toBeFocused();
});

test("long preset lists scroll inside the modal with actions visible on desktop and mobile", async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await page.route("**/neriss_comfynodes/resolution/presets", (route) =>
    route.fulfill({
      json: { presets: Array.from({ length: 30 }, (_, i) => ({ name: `Ratio ${i + 1}`, x: i + 1, y: 3 })) },
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page.getByRole("button", { name: "Manage presets", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Manage aspect-ratio presets", exact: true });
  const rows = modal.getByRole("group", { name: "Presets", exact: true });
  expect(await rows.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(modal.getByRole("button", { name: "Save presets", exact: true })).toBeInViewport();
  await expect(modal.getByRole("button", { name: "Add preset", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("preset-modal.png") });
  await modal.getByRole("button", { name: "Add preset", exact: true }).click();
  await expect(modal.getByRole("textbox", { name: "Preset 31 name", exact: true })).toBeFocused();
  await expect(modal.getByRole("textbox", { name: "Preset 31 name", exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(modal.getByRole("button", { name: "Save presets", exact: true })).toBeInViewport();
  await expect(modal.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const rowBoxes = await modal.locator(".preset-draft").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }),
  );
  for (let index = 1; index < rowBoxes.length; index += 1)
    expect(rowBoxes[index].top).toBeGreaterThanOrEqual(rowBoxes[index - 1].bottom);
  const listBounds = await rows.boundingBox();
  const footerBounds = await modal.locator("footer").boundingBox();
  if (listBounds && footerBounds) expect(listBounds.y + listBounds.height).toBeLessThanOrEqual(footerBounds.y + 1);
  await page.screenshot({ path: testInfo.outputPath("preset-modal-mobile.png") });
});

test("preset drag ordering stays a draft, saves globally, and applying a ratio remains undoable", async ({ page }) => {
  let presets = [
    { name: "My banner", x: 7, y: 2 },
    { name: "My poster", x: 3, y: 5 },
    { name: "Square", x: 1, y: 1 },
  ];
  let loads = 0;
  let saves = 0;
  await page.route("**/neriss_comfynodes/resolution/presets", async (route) => {
    if (route.request().method() === "POST") {
      saves += 1;
      const payload: unknown = route.request().postDataJSON();
      presets = z.object({ presets: z.array(resolutionPresetSchema) }).parse(payload).presets;
    } else loads += 1;
    await route.fulfill({ json: { presets } });
  });
  await page.goto("/preview/index.html");
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  const before = await readState(page);
  const trigger = page.getByRole("button", { name: "Manage presets", exact: true });
  const modal = page.getByRole("dialog", { name: "Manage aspect-ratio presets", exact: true });
  await trigger.click();
  await modal.getByRole("textbox", { name: "Preset 1 name", exact: true }).fill("Edited banner");
  await modal
    .getByRole("button", { name: "Drag to reorder preset 1", exact: true })
    .dragTo(modal.getByRole("group", { name: "Preset 3", exact: true }), { targetPosition: { x: 100, y: 44 } });
  await expect(modal.getByRole("textbox", { name: "Preset 3 name", exact: true })).toHaveValue("Edited banner");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(saves).toBe(0);
  await trigger.click();
  await expect(modal.getByRole("textbox", { name: "Preset 1 name", exact: true })).toHaveValue("My banner");
  await modal
    .getByRole("button", { name: "Drag to reorder preset 3", exact: true })
    .dragTo(modal.getByRole("group", { name: "Preset 1", exact: true }), { targetPosition: { x: 100, y: 2 } });
  await expect(modal.getByRole("textbox", { name: "Preset 1 name", exact: true })).toHaveValue("Square");
  const handle = modal.getByRole("button", { name: "Drag to reorder preset 1", exact: true });
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await expect(modal.getByRole("button", { name: "Drag to reorder preset 2", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(handle).toBeFocused();
  await modal.getByRole("button", { name: "Save presets", exact: true }).click();
  await expect(modal).toHaveCount(0);
  const ratios = page.getByRole("combobox", { name: "Aspect ratio", exact: true });
  await expect(ratios.locator("option")).toHaveText(["Custom", "Square · 1:1", "My banner · 7:2", "My poster · 3:5"]);
  expect(await readState(page)).toEqual(before);
  await ratios.selectOption("My poster");
  expect((await readState(page)).height).toBeGreaterThan((await readState(page)).width);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await readState(page)).toEqual(before);
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Resolution Selector preset" }).locator("option")).toHaveText([
    "Square",
    "My banner",
    "My poster",
  ]);
  expect(loads).toBe(1);
  expect(saves).toBe(1);
});

test("the standalone preset manager uses the editor theme and publishes changes to the canvas", async ({
  page,
}, testInfo) => {
  let presets = [{ name: "My banner", x: 7, y: 2 }];
  await page.route("**/neriss_comfynodes/resolution/presets", async (route) => {
    if (route.request().method() === "POST") {
      const payload: unknown = route.request().postDataJSON();
      presets = z.object({ presets: z.array(resolutionPresetSchema) }).parse(payload).presets;
    }
    await route.fulfill({ json: { presets } });
  });
  await page.goto("/preview/index.html?manager=1");
  const modal = page.getByRole("dialog", { name: "Manage aspect-ratio presets", exact: true });
  await expect(modal).toHaveCSS("background-color", "rgb(27, 27, 27)");
  const name = modal.getByRole("textbox", { name: "Preset 1 name", exact: true });
  await expect(name).toHaveCSS("background-color", "rgb(22, 22, 22)");
  await expect(name).toHaveCSS("color", "rgb(228, 228, 228)");
  await expect(modal.getByRole("button", { name: "Save presets", exact: true })).toHaveCSS(
    "background-color",
    "rgb(40, 48, 41)",
  );
  await name.fill("New ratio");
  await page.screenshot({ path: testInfo.outputPath("standalone-preset-manager.png") });
  await modal.getByRole("button", { name: "Save presets", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Resolution Selector preset" }).locator("option")).toHaveText([
    "My banner",
    "New ratio",
  ]);
  await page.getByRole("button", { name: "Open MOSS editor", exact: true }).click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Aspect ratio", exact: true }).locator("option")).toHaveText([
    "Custom",
    "New ratio · 7:2",
  ]);
});

test("the standalone manager can retry failed loads without losing its modal", async ({ page }) => {
  let failing = true;
  await page.route("**/neriss_comfynodes/resolution/presets", (route) =>
    route.fulfill(
      failing ? { status: 503, body: "Unavailable" } : { json: { presets: [{ name: "Recovered", x: 4, y: 3 }] } },
    ),
  );
  await page.goto("/preview/index.html?manager=1");
  const modal = page.getByRole("dialog", { name: "Manage aspect-ratio presets", exact: true });
  await expect(modal.getByRole("alert")).toContainText("Unavailable");
  await expect(modal.getByRole("button", { name: "Save presets", exact: true })).toBeDisabled();
  failing = false;
  await modal.getByRole("button", { name: "Retry loading presets", exact: true }).click();
  await expect(modal.getByRole("textbox", { name: "Preset 1 name", exact: true })).toHaveValue("Recovered");
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
});
