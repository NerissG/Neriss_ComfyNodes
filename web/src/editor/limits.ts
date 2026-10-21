import { Result, err } from "neverthrow";
import { z } from "zod";
import { editorErrors } from "@/errors";

export const MAX_REGIONS = 2048;
export const MAX_TAGS = 256;
export const textSchema = z.string().max(65_536);

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
