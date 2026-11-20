import { createPresetLibrary } from "@/shared/library";
import { loadResolutionPresets, saveResolutionPresets } from "./api";

export const presetLibrary = createPresetLibrary(loadResolutionPresets, saveResolutionPresets);
