import { ResultAsync, err, errAsync, ok } from "neverthrow";
import { z } from "zod";
import type { ComfyNode } from "@/comfy/types";
import { comfyUrl, fetchComfy } from "@/comfy/api";
import { editorErrors, type AppError } from "@/errors";

export function readWidgetValue(node: ComfyNode, name: string): unknown {
  return node.widgets?.find((widget) => widget.name === name)?.value;
}

export function writeWidgetValue(node: ComfyNode, name: string, value: unknown) {
  const widget = node.widgets?.find((widget) => widget.name === name);
  if (widget) {
    widget.value = value;
    node.setDirtyCanvas?.call(node, true, true);
  }
}

export function readClipboardText(): ResultAsync<string, AppError> {
  return ResultAsync.fromPromise(navigator.clipboard.readText(), (cause) =>
    editorErrors.runtime("Could not read clipboard", undefined, cause),
  );
}

export function writeClipboardText(text: string): ResultAsync<void, AppError> {
  return ResultAsync.fromPromise(navigator.clipboard.writeText(text), (cause) =>
    editorErrors.runtime("Could not write clipboard", undefined, cause),
  );
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
  return ResultAsync.fromPromise(fetchComfy(referenceEndpoint, { method: "POST", body: data }), (cause) =>
    editorErrors.runtime("Could not upload reference image", undefined, cause),
  )
    .andThen((response) => {
      if (!response.ok) return errAsync(editorErrors.runtime(`Reference image upload failed: ${response.statusText}`));
      return ResultAsync.fromPromise(response.json(), (cause) =>
        editorErrors.runtime("Could not read upload response", undefined, cause),
      );
    })
    .andThen((payload) => {
      const parsed = referenceImageSchema.safeParse(payload);
      return parsed.success
        ? ok(parsed.data)
        : err(editorErrors.runtime("Invalid reference image response", { issues: parsed.error.issues }));
    });
}

export function readClipboardImage(): ResultAsync<File, AppError> {
  if (!navigator.clipboard.read)
    return errAsync(editorErrors.runtime("Clipboard image reading is not supported by this browser"));
  return ResultAsync.fromPromise(navigator.clipboard.read(), (cause) =>
    editorErrors.runtime("Could not read clipboard image", undefined, cause),
  ).andThen((items) => {
    for (const item of items) {
      const type = item.types.find((value) => value.startsWith("image/"));
      if (type)
        return ResultAsync.fromPromise(item.getType(type), (cause) =>
          editorErrors.runtime("Could not read image data", undefined, cause),
        ).map((blob) => new File([blob], `clipboard.${type.split("/")[1] || "png"}`, { type }));
    }
    return errAsync(editorErrors.runtime("Clipboard does not contain an image"));
  });
}

export function inputValue(event: Event): string {
  const target = event.currentTarget;
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
    ? target.value
    : "";
}

export function numberInputValue(event: Event, fallback: number): number {
  const value = Number(inputValue(event));
  return Number.isFinite(value) ? value : fallback;
}
