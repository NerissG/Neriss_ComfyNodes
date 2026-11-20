import { createPresetLibrary } from "@/shared/library";
import { loadLayoutPresets, saveLayoutPresets } from "./api";

export const layoutPresetLibrary = createPresetLibrary(loadLayoutPresets, saveLayoutPresets);
