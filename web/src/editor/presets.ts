import { ResultAsync, err, errAsync, ok, type Result } from "neverthrow";
import { z } from "zod";
import { editorErrors, type AppError } from "@/errors";
import { stylePresetSchema, type StylePreset } from "@/editor/state";
import { fetchLibrary } from "@/comfy/api";

const presetPayloadSchema = z.object({
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

const endpoint = "/neriss_comfynodes/ideogram/style_presets";

function responseJson(response: Response): ResultAsync<unknown, AppError> {
  if (!response.ok) {
    return ResultAsync.fromPromise(response.text(), (cause) =>
      editorErrors.runtime("Could not read preset error response", undefined, cause),
    ).andThen((message) => err(editorErrors.runtime(`Preset request failed: ${message || response.statusText}`)));
  }

  return ResultAsync.fromPromise(response.json(), (cause) =>
    editorErrors.runtime("Could not read preset response", undefined, cause),
  );
}

export function loadStylePresets(): ResultAsync<StylePreset[], AppError> {
  return ResultAsync.fromPromise(fetchLibrary(endpoint), (cause) =>
    editorErrors.runtime("Could not load style presets", undefined, cause),
  )
    .andThen(responseJson)
    .andThen((payload): Result<StylePreset[], AppError> => {
      const result = presetPayloadSchema.safeParse(payload);
      if (!result.success) {
        return err(editorErrors.runtime("Style preset file is invalid", { issues: result.error.issues }, result.error));
      }
      return ok(result.data.presets);
    });
}

export function saveStylePresets(presets: StylePreset[]): ResultAsync<void, AppError> {
  const parsed = presetPayloadSchema.safeParse({ presets });
  if (!parsed.success) return errAsync(editorErrors.runtime("Invalid style presets"));
  const payload = parsed.data;
  return ResultAsync.fromPromise(
    fetchLibrary(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    (cause) => editorErrors.runtime("Could not save style presets", undefined, cause),
  )
    .andThen(responseJson)
    .map(() => undefined);
}
