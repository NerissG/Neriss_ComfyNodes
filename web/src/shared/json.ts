import { Result, err } from "neverthrow";
import { editorErrors } from "@/errors";

const readJson = Result.fromThrowable(
  (value: string): unknown => JSON.parse(value),
  (cause) => editorErrors.runtime("Could not parse JSON", undefined, cause),
);

export function parseBoundedJson(value: string) {
  if (value.length > 2 * 1024 * 1024 || new TextEncoder().encode(value).byteLength > 2 * 1024 * 1024) {
    return err(editorErrors.runtime("JSON exceeds the 2 MiB limit"));
  }
  return readJson(value);
}
