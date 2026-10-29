import { errAsync } from "neverthrow";
import { z } from "zod";
import { fetchLibrary, jsonBody, requestJson } from "@/comfy/api";
import { comfyErrors } from "@/errors";

export type ResolutionPreset = {
  name: string;
  x: number;
  y: number;
};

export const resolutionPresetSchema = z.object({
  name: z.string().trim().min(1).max(65_536),
  x: z.number().int().min(1).max(100_000),
  y: z.number().int().min(1).max(100_000),
}) satisfies z.ZodType<ResolutionPreset>;

const presetPayloadSchema = z.object({
  presets: z.array(resolutionPresetSchema).min(1).max(256),
});

const endpoint = "/neriss_comfynodes/resolution/presets";

export function loadResolutionPresets() {
  return requestJson(endpoint, presetPayloadSchema, "resolution presets", undefined, fetchLibrary).map(
    (payload) => payload.presets,
  );
}

export function saveResolutionPresets(presets: ResolutionPreset[]) {
  const payload = presetPayloadSchema.safeParse({ presets });
  if (!payload.success) {
    return errAsync(
      comfyErrors.runtime("Resolution presets are invalid", { issues: payload.error.issues }, payload.error),
    );
  }
  const names = new Set<string>();
  for (const preset of payload.data.presets) {
    if (names.has(preset.name)) {
      return errAsync(comfyErrors.runtime(`Duplicate resolution preset name: ${preset.name}`));
    }
    names.add(preset.name);
  }
  return requestJson(endpoint, presetPayloadSchema, "resolution presets", jsonBody(payload.data), fetchLibrary).map(
    (saved) => saved.presets,
  );
}
