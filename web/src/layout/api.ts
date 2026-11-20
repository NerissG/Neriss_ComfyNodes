import { errAsync, type ResultAsync } from "neverthrow";
import { z } from "zod";
import { comfyUrl, fetchLibrary, jsonBody, requestJson } from "@/comfy/api";
import { editorErrors, type AppError } from "@/errors";
import { MAX_PRESETS } from "./limits";
import { layoutPresetSchema, type LayoutPreset } from "./state";

export const layoutPresetPayloadSchema = z.object({
  presets: z
    .array(layoutPresetSchema)
    .max(MAX_PRESETS)
    .refine(
      (presets) =>
        new Set(presets.map((preset) => preset.id)).size === presets.length &&
        new Set(presets.map((preset) => preset.name)).size === presets.length,
      "Preset IDs and names must be unique",
    ),
});
const layoutPresetEndpoint = "/neriss_comfynodes/editor/presets";

export function loadLayoutPresets(): ResultAsync<LayoutPreset[], AppError> {
  return requestJson(layoutPresetEndpoint, layoutPresetPayloadSchema, "layout presets", undefined, fetchLibrary).map(
    (payload) => payload.presets,
  );
}

export function saveLayoutPresets(presets: LayoutPreset[]): ResultAsync<LayoutPreset[], AppError> {
  const payload = layoutPresetPayloadSchema.safeParse({ presets });
  if (!payload.success) return errAsync(editorErrors.runtime("Invalid layout presets"));
  return requestJson(
    layoutPresetEndpoint,
    layoutPresetPayloadSchema,
    "layout presets",
    jsonBody(payload.data),
    fetchLibrary,
  ).map((saved) => saved.presets);
}

const referenceImageSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ReferenceImage = z.infer<typeof referenceImageSchema>;
const referenceEndpoint = "/neriss_comfynodes/editor/reference_image";

export function referenceImageUrl(path: string): string {
  return `${comfyUrl(referenceEndpoint)}?path=${encodeURIComponent(path)}`;
}

export function uploadReferenceImage(file: File): ResultAsync<ReferenceImage, AppError> {
  const data = new FormData();
  data.append("image", file);
  return requestJson(referenceEndpoint, referenceImageSchema, "the reference image upload", {
    method: "POST",
    body: data,
  });
}
