import type { Page } from "@playwright/test";
import { defaultUiSettings, uiSettingsSchema, type UiSettings } from "../src/settings/schema";

export async function mockUiSettings(page: Page, initial = defaultUiSettings()) {
  const saves: UiSettings[] = [];
  const control = { settings: initial, loads: 0, saves, loadError: false, saveError: false };
  await page.route("**/neriss_comfynodes/ui/settings", async (route) => {
    if (route.request().method() === "GET") {
      control.loads += 1;
      await route.fulfill(
        control.loadError
          ? { status: 500, json: { error: "UI settings file is unreadable; it has not been replaced" } }
          : { json: control.settings },
      );
      return;
    }
    if (control.saveError) {
      await route.fulfill({ status: 500, json: { error: "Could not save UI settings" } });
      return;
    }
    const payload: unknown = route.request().postDataJSON();
    const parsed = uiSettingsSchema.safeParse(payload);
    if (!parsed.success) {
      await route.fulfill({ status: 400, json: { error: "Invalid UI settings" } });
      return;
    }
    control.settings = parsed.data;
    control.saves.push(parsed.data);
    await route.fulfill({ json: parsed.data });
  });
  return control;
}
