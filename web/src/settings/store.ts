import { ResultAsync, err, okAsync } from "neverthrow";
import { readonly, writable } from "svelte/store";
import { editorErrors, type AppError } from "@/errors";
import { defaultUiSettings, uiSettingsSchema, type EditorPreferences, type UiSettings } from "./schema";
import { loadUiSettings, saveUiSettings } from "./services";

type SettingsState = {
  settings: UiSettings;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: AppError | null;
};

export function createUiSettingsStore(load = loadUiSettings, save = saveUiSettings) {
  let snapshot: SettingsState = {
    settings: defaultUiSettings(),
    loaded: false,
    loading: false,
    saving: false,
    error: null,
  };
  const state = writable(snapshot);
  let pending: ResultAsync<UiSettings, AppError> | null = null;
  let queue = Promise.resolve();
  let failedChange: Partial<EditorPreferences> | null = null;

  function update(change: Partial<SettingsState>) {
    snapshot = { ...snapshot, ...change };
    state.set(snapshot);
  }
  function ensureLoaded(): ResultAsync<UiSettings, AppError> {
    if (snapshot.loaded) return okAsync(snapshot.settings);
    if (pending) return pending;
    update({ loading: true, error: null });
    pending = load()
      .andThen((value) => {
        const parsed = uiSettingsSchema.safeParse(value);
        return parsed.success
          ? okAsync(parsed.data)
          : err(editorErrors.runtime("Saved UI settings are invalid; saving is disabled."));
      })
      .map((settings) => {
        update({ settings, loaded: true, loading: false, error: null });
        pending = null;
        return settings;
      })
      .mapErr((error) => {
        update({ loading: false, error });
        pending = null;
        return error;
      });
    return pending;
  }

  function saveEditor(change: Partial<EditorPreferences>): ResultAsync<UiSettings, AppError> {
    // Apply each patch to the latest successful snapshot, not the one present
    // when it was enqueued. A sidebar save must not undo a shortcut save.
    const task = queue.then(async () => {
      const loaded = await ensureLoaded();
      if (loaded.isErr()) return loaded;
      const patch = { ...failedChange, ...change };
      const parsed = uiSettingsSchema.safeParse({
        ...snapshot.settings,
        editor: { ...snapshot.settings.editor, ...patch },
      });
      if (!parsed.success) {
        const error = editorErrors.runtime(parsed.error.issues.map((issue) => issue.message).join(" "));
        update({ error });
        return err(error);
      }
      update({ saving: true, error: null });
      const result = await save(parsed.data);
      if (result.isOk()) {
        failedChange = null;
        update({ settings: result.value, saving: false, error: null });
      } else {
        failedChange = patch;
        update({
          saving: false,
          error: result.error,
          loaded: result.error.details?.status === 409 ? false : snapshot.loaded,
        });
      }
      return result;
    });
    queue = task.then(() => undefined);
    return ResultAsync.fromSafePromise(task).andThen((result) => result);
  }

  function retry() {
    return failedChange ? saveEditor({}) : ensureLoaded();
  }
  function discardShortcutDraft() {
    if (!failedChange?.shortcuts) return;
    const next = { ...failedChange };
    delete next.shortcuts;
    failedChange = Object.keys(next).length ? next : null;
    if (!failedChange) update({ error: null });
  }

  return { ...readonly(state), ensureLoaded, saveEditor, retry, discardShortcutDraft };
}

export const uiSettings = createUiSettingsStore();
