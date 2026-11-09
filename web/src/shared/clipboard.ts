import { ResultAsync } from "neverthrow";
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
