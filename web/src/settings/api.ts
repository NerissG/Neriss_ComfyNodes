import { fetchLibrary, jsonBody, requestJson } from "@/comfy/api";
import { uiSettingsSchema, type UiSettings } from "./schema";

const endpoint = "/neriss_comfynodes/ui/settings";

export function loadUiSettings() {
  return requestJson(endpoint, uiSettingsSchema, "UI settings", undefined, fetchLibrary);
}

export function saveUiSettings(settings: UiSettings) {
  return requestJson(endpoint, uiSettingsSchema, "UI settings", jsonBody(settings), fetchLibrary);
}
