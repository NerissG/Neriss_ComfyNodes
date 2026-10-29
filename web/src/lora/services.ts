import { ResultAsync, err, errAsync, ok } from "neverthrow";
import { writable } from "svelte/store";
import { z } from "zod";
import { fetchComfy } from "@/comfy/api";
import type { ComfyNode } from "@/comfy/types";
import { editorErrors } from "@/errors";
import { manifestSchema } from "./state";

export const loraEditorNode = writable<ComfyNode | null>(null);
const loraNamesSchema = z.array(z.string().min(1).max(2048));

export function loraChoices(node: ComfyNode): string[] {
  const widget = node.widgets?.find((entry) => entry.name === "lora_name");
  const parsed = loraNamesSchema.safeParse(widget?.options?.values ?? []);
  const current = typeof widget?.value === "string" && widget.value ? [widget.value] : [];
  return [...new Set([...current, ...(parsed.success ? parsed.data : [])])];
}

export function openLoraEditor(node: ComfyNode) {
  loraEditorNode.set(node);
}

export function loadLoraTargets(name: string) {
  return ResultAsync.fromPromise(
    fetchComfy(`/neriss_comfynodes/lora/targets?lora_name=${encodeURIComponent(name)}`),
    (cause) => editorErrors.runtime("Could not inspect LoRA", undefined, cause),
  ).andThen((response) =>
    ResultAsync.fromPromise(response.json(), (cause) =>
      editorErrors.runtime(`Could not read LoRA response (${response.status})`, undefined, cause),
    ).andThen((payload: unknown) => {
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(payload);
        return errAsync(editorErrors.runtime(failure.success ? failure.data.error : "LoRA inspection failed"));
      }
      const parsed = manifestSchema.safeParse(payload);
      return parsed.success && parsed.data.lora_name === name
        ? ok(parsed.data)
        : err(editorErrors.runtime("Invalid LoRA target manifest"));
    }),
  );
}
