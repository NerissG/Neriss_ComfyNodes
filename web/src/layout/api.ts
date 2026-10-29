import { errAsync, type ResultAsync } from "neverthrow";
import { z } from "zod";
import { comfyUrl, fetchLibrary, jsonBody, requestJson } from "@/comfy/api";
import { editorErrors, type AppError } from "@/errors";
import { stylePresetSchema, type StylePreset } from "./state";

const stylePresetPayloadSchema = z.object({
  presets: z
    .array(stylePresetSchema)
    .max(256)
    .refine(
      (presets) =>
        new Set(presets.map((preset) => preset.id)).size === presets.length &&
        new Set(presets.map((preset) => preset.name)).size === presets.length,
      "Preset IDs and names must be unique",
    ),
});
const stylePresetEndpoint = "/neriss_comfynodes/ideogram/style_presets";

export function loadStylePresets(): ResultAsync<StylePreset[], AppError> {
  return requestJson(stylePresetEndpoint, stylePresetPayloadSchema, "style presets", undefined, fetchLibrary).map(
    (payload) => payload.presets,
  );
}

export function saveStylePresets(presets: StylePreset[]): ResultAsync<StylePreset[], AppError> {
  const payload = stylePresetPayloadSchema.safeParse({ presets });
  if (!payload.success) return errAsync(editorErrors.runtime("Invalid style presets"));
  return requestJson(
    stylePresetEndpoint,
    stylePresetPayloadSchema,
    "style presets",
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
