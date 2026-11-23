import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { jsonBody, requestJson, requestResponse } from "@/comfy/api";
import { comfyErrors } from "@/errors";
import { manifestSchema, type StrengthState } from "./state";

export function loadLoraTargets(name: string) {
  return requestJson(
    `/neriss_comfynodes/lora/targets?lora_name=${encodeURIComponent(name)}`,
    manifestSchema,
    "LoRA targets",
  ).andThen((manifest) =>
    manifest.lora_name === name ? okAsync(manifest) : errAsync(comfyErrors.runtime("Invalid LoRA targets response")),
  );
}

export function exportLora(state: StrengthState, strengthModel: number, strengthClip: number) {
  return requestResponse(
    "/neriss_comfynodes/lora/export",
    "LoRA export",
    jsonBody({ state, strength_model: strengthModel, strength_clip: strengthClip }),
  ).andThen((response) =>
    ResultAsync.fromPromise(response.blob(), (cause) =>
      comfyErrors.runtime("Could not read LoRA download", undefined, cause),
    ),
  );
}
