import { expect, test } from "@playwright/test";
import { mockUiSettings } from "./settings-mock";

test("the declared browser can render the editor without runtime errors", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockUiSettings(page);
  await page.route("**/neriss_comfynodes/resolution/presets", (route) =>
    route.fulfill({ json: { presets: [{ name: "Square", x: 1, y: 1 }] } }),
  );
  await page.goto("/preview/index.html");
  await expect(page.getByRole("dialog", { name: "MOSS Layout Prompt Editor" })).toBeVisible();
  await expect(page.locator(".region-item")).toHaveCount(9);
  await expect(page.getByRole("application", { name: "Layout canvas" })).toBeVisible();
  // Boxes must follow the measured canvas frame, including on the initial render.
  await expect
    .poll(async () => (await page.locator(".region-rect").first().boundingBox())?.width ?? 0)
    .toBeGreaterThan(100);
  const region = await page.locator(".region-rect").first().boundingBox();
  const frame = await page.locator("svg > g > rect").first().boundingBox();
  expect(region?.x).toBeGreaterThan(frame?.x ?? 0);
  await page.screenshot({ path: testInfo.outputPath("editor.png") });
  expect(errors).toEqual([]);
});
