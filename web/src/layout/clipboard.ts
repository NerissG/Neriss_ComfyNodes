import { ResultAsync, errAsync } from "neverthrow";
import { editorErrors, type AppError } from "@/errors";

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
