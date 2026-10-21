import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { z } from "zod";
import { resolutionPresetSchema } from "../src/resolution/presets";
import { parseEditorState } from "../src/editor/state";
import { test } from "./fixtures";

const endpoint = "**/neriss_comfynodes/resolution/presets";

test("preset conflicts preserve drafts, require confirmation, and recover after a failed reload", async ({
  page,
}, testInfo) => {
  let presets = [{ name: "Original", x: 1, y: 1 }];
  let revision = 1;
  let failReload = false;
  let loads = 0;
  const writes: (string | undefined)[] = [];
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "POST") {
      const expected = route.request().headers()["if-match"];
      writes.push(expected);
      if (expected !== `"${revision}"`) {
        await route.fulfill({ status: 409, json: { error: "Library changed in another tab; reload before saving" } });
        return;
      }
      const payload: unknown = route.request().postDataJSON();
      presets = z.object({ presets: z.array(resolutionPresetSchema) }).parse(payload).presets;
      revision += 1;
    } else {
      loads += 1;
      if (failReload) {
        await route.fulfill({ status: 503, body: "Reload unavailable" });
        return;
      }
    }
    await route.fulfill({ json: { presets }, headers: { ETag: `"${revision}"` } });
  });
  await page.goto("/preview/index.html?manager=1");
  const modal = page.getByRole("dialog", { name: "Manage aspect-ratio presets", exact: true });
  const name = modal.getByRole("textbox", { name: "Preset 1 name", exact: true });
  await expect(name).toHaveValue("Original");
  await name.fill("Unsaved draft");
  // Another tab saves a new server revision while this modal is open.
  presets = [{ name: "Other tab", x: 9, y: 16 }];
  revision = 2;
  await modal.getByRole("button", { name: "Save presets", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("changed in another tab");
  await expect(name).toHaveValue("Unsaved draft");
  await expect(modal.getByRole("button", { name: "Save presets", exact: true })).toBeDisabled();
  expect(writes).toEqual(['"1"']);
  const beforeReload = loads;
  await modal.getByRole("button", { name: "Reload latest presets", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 700 });
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(modal.getByRole("button", { name: "Discard draft and reload", exact: true })).toBeInViewport();
  await modal.screenshot({ path: testInfo.outputPath("preset-conflict-mobile.png") });
  await expect(name).toHaveValue("Unsaved draft");
  expect(loads).toBe(beforeReload);
  await modal.getByRole("button", { name: "Keep draft", exact: true }).click();
  await expect(name).toHaveValue("Unsaved draft");
  await modal.getByRole("button", { name: "Reload latest presets", exact: true }).click();
  failReload = true;
  await modal.getByRole("button", { name: "Discard draft and reload", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Reload unavailable");
  await expect(name).toHaveValue("Unsaved draft");
  failReload = false;
  await modal.getByRole("button", { name: "Discard draft and reload", exact: true }).click();
  await expect(name).toHaveValue("Other tab");
  await expect(modal.getByRole("spinbutton", { name: "Preset 1 height", exact: true })).toHaveValue("16");
  await expect(modal.getByRole("button", { name: "Save presets", exact: true })).toBeEnabled();
  await name.fill("Reviewed change");
  await modal.getByRole("button", { name: "Save presets", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(writes).toEqual(['"1"', '"2"']);
  expect(presets).toEqual([{ name: "Reviewed change", x: 9, y: 16 }]);
});

test("closing a conflicted preset manager forces a fresh load when reopened", async ({ page }) => {
  let loads = 0;
  let changed = false;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "POST") {
      changed = true;
      await route.fulfill({ status: 409, json: { error: "Conflict" } });
      return;
    }
    loads += 1;
    await route.fulfill({
      json: { presets: [{ name: changed ? "Fresh server value" : "Old value", x: 1, y: 1 }] },
      headers: { ETag: changed ? '"new"' : '"old"' },
    });
  });
  await page.goto("/preview/index.html?manager=1");
  const modal = page.getByRole("dialog", { name: "Manage aspect-ratio presets", exact: true });
  await expect(modal.getByRole("textbox", { name: "Preset 1 name", exact: true })).toHaveValue("Old value");
  await modal.getByRole("button", { name: "Save presets", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Conflict");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Manage AR Presets", exact: true }).click();
  await expect(modal.getByRole("textbox", { name: "Preset 1 name", exact: true })).toHaveValue("Fresh server value");
  expect(loads).toBe(2);
});

for (const model of ["ideogram", "moss"]) {
  for (const raw of ['{"version":999,"note":"keep original"}', "{broken state"]) {
    test(`${model}: recovery retains, downloads, closes and explicitly resets ${raw.startsWith('{"version') ? "unsupported" : "invalid"} state`, async ({
      page,
    }) => {
      await page.route(endpoint, (route) => route.fulfill({ json: { presets: [{ name: "Square", x: 1, y: 1 }] } }));
      await page.goto(`/preview/index.html?model=${model}&state=${encodeURIComponent(raw)}`);
      const recovery = page.getByRole("region", { name: "Editor state recovery", exact: true });
      await expect(recovery).toBeVisible();
      await expect(page.getByTestId("saved-state")).toHaveText(raw);
      const downloading = page.waitForEvent("download");
      await recovery.getByRole("button", { name: "Download original state", exact: true }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe("neriss-editor-state.txt");
      expect(await readFile((await download.path()) ?? "", "utf8")).toBe(raw);
      await recovery.getByRole("button", { name: "Reset layout…", exact: true }).click();
      await expect(page.getByTestId("saved-state")).toHaveText(raw);
      await recovery.getByRole("button", { name: "Close without changes", exact: true }).click();
      await expect(recovery).toHaveCount(0);
      await expect(page.getByTestId("saved-state")).toHaveText(raw);
      await page
        .getByRole("button", { name: model === "moss" ? "Open MOSS editor" : "Open Ideogram editor", exact: true })
        .click();
      await recovery.getByRole("button", { name: "Reset layout…", exact: true }).click();
      await recovery.getByRole("button", { name: "Confirm replacement with empty layout", exact: true }).click();
      await expect(recovery).toHaveCount(0);
      const reset = parseEditorState(await page.getByTestId("saved-state").textContent())._unsafeUnwrap();
      expect(reset.elements).toEqual([]);
      expect(reset.version).toBe(1);
    });
  }
}
