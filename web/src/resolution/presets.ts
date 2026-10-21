import { ResultAsync, err, errAsync, ok, type Result } from "neverthrow";
import { z } from "zod";
import { comfyErrors, type AppError } from "@/errors";
import { fetchLibrary } from "@/comfy/api";

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

function responseJson(response: Response): ResultAsync<unknown, AppError> {
  if (!response.ok) {
    return ResultAsync.fromPromise(response.text(), (cause) =>
      comfyErrors.runtime("Could not read resolution preset error response", undefined, cause),
    ).andThen((message) =>
      err(
        comfyErrors.runtime(`Resolution preset request failed: ${message || response.statusText}`, {
          status: response.status,
        }),
      ),
    );
  }

  return ResultAsync.fromPromise(response.json(), (cause) =>
    comfyErrors.runtime("Could not read resolution preset response", undefined, cause),
  );
}

export function loadResolutionPresets(): ResultAsync<ResolutionPreset[], AppError> {
  return ResultAsync.fromPromise(fetchLibrary(endpoint), (cause) =>
    comfyErrors.runtime("Could not load resolution presets", undefined, cause),
  )
    .andThen(responseJson)
    .andThen((payload): Result<ResolutionPreset[], AppError> => {
      const result = presetPayloadSchema.safeParse(payload);
      if (!result.success) {
        return err(
          comfyErrors.runtime("Resolution preset file is invalid", { issues: result.error.issues }, result.error),
        );
      }
      return ok(result.data.presets);
    });
}

export function saveResolutionPresets(presets: ResolutionPreset[]): ResultAsync<ResolutionPreset[], AppError> {
  const payloadResult = presetPayloadSchema.safeParse({ presets });
  if (!payloadResult.success) {
    return errAsync(
      comfyErrors.runtime(
        "Resolution presets are invalid",
        { issues: payloadResult.error.issues },
        payloadResult.error,
      ),
    );
  }
  const payload = payloadResult.data;
  const names = new Set<string>();
  for (const preset of payload.presets) {
    if (names.has(preset.name)) {
      return errAsync(comfyErrors.runtime(`Duplicate resolution preset name: ${preset.name}`));
    }
    names.add(preset.name);
  }

  return ResultAsync.fromPromise(
    fetchLibrary(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    (cause) => comfyErrors.runtime("Could not save resolution presets", undefined, cause),
  )
    .andThen(responseJson)
    .andThen((responsePayload): Result<ResolutionPreset[], AppError> => {
      const result = presetPayloadSchema.safeParse(responsePayload);
      if (!result.success) {
        return err(
          comfyErrors.runtime(
            "Resolution preset save response is invalid",
            { issues: result.error.issues },
            result.error,
          ),
        );
      }
      return ok(result.data.presets);
    });
}
