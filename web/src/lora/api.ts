import { errAsync, okAsync } from "neverthrow";
import { requestJson } from "@/comfy/api";
import { comfyErrors } from "@/errors";
import { manifestSchema } from "./state";

export function loadLoraTargets(name: string) {
  return requestJson(
    `/neriss_comfynodes/lora/targets?lora_name=${encodeURIComponent(name)}`,
    manifestSchema,
    "LoRA targets",
  ).andThen((manifest) =>
    manifest.lora_name === name ? okAsync(manifest) : errAsync(comfyErrors.runtime("Invalid LoRA targets response")),
  );
}
