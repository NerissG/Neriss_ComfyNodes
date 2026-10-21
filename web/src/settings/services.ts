import { ResultAsync, err, errAsync, ok } from "neverthrow";
import { z } from "zod";
import { fetchLibrary } from "@/comfy/api";
import { editorErrors, type AppError } from "@/errors";
import { uiSettingsSchema, type UiSettings } from "./schema";

const endpoint = "/neriss_comfynodes/ui/settings";
const errorPayload = z.object({ error: z.string() });

function request(init?: RequestInit): ResultAsync<UiSettings, AppError> {
  return ResultAsync.fromPromise(fetchLibrary(endpoint, init), (cause) =>
    editorErrors.runtime("Could not reach UI settings. Changes cannot be saved.", undefined, cause),
  ).andThen((response) =>
    ResultAsync.fromPromise(response.json(), (cause) =>
      editorErrors.runtime("Could not read the UI settings response.", undefined, cause),
    ).andThen((payload: unknown) => {
      if (!response.ok) {
        const parsed = errorPayload.safeParse(payload);
        return errAsync(
          editorErrors.runtime(
            parsed.success ? parsed.data.error : `UI settings request failed (${response.status}).`,
            { status: response.status },
          ),
        );
      }
      const parsed = uiSettingsSchema.safeParse(payload);
      return parsed.success
        ? ok(parsed.data)
        : err(
            editorErrors.runtime("UI settings are invalid or unsupported; the saved file has not been replaced.", {
              issues: parsed.error.issues,
            }),
          );
    }),
  );
}

export function loadUiSettings(): ResultAsync<UiSettings, AppError> {
  return request();
}
export function saveUiSettings(settings: UiSettings): ResultAsync<UiSettings, AppError> {
  return request({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
}
