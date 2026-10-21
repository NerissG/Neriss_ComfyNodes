import { ResultAsync, okAsync } from "neverthrow";
import { readonly, writable } from "svelte/store";
import type { AppError } from "@/errors";
import { loadResolutionPresets, saveResolutionPresets, type ResolutionPreset } from "./presets";

type PresetLibraryState = {
  presets: ResolutionPreset[];
  loaded: boolean;
  loading: boolean;
  error: AppError | null;
};

export function createPresetLibrary(load = loadResolutionPresets, save = saveResolutionPresets) {
  let snapshot: PresetLibraryState = { presets: [], loaded: false, loading: false, error: null };
  const state = writable(snapshot);
  let pending: ResultAsync<ResolutionPreset[], AppError> | null = null;
  let revision = 0;

  function update(change: Partial<PresetLibraryState>) {
    snapshot = { ...snapshot, ...change };
    state.set(snapshot);
  }

  function reload(): ResultAsync<ResolutionPreset[], AppError> {
    if (pending) return pending;
    const requestRevision = revision;
    update({ loading: true, error: null });
    pending = load()
      .map((presets) => {
        // A GET started before a successful save must not overwrite it.
        if (requestRevision !== revision) return snapshot.presets;
        update({ presets, loaded: true, error: null });
        update({ loading: false });
        pending = null;
        return snapshot.presets;
      })
      .mapErr((error) => {
        if (requestRevision !== revision) return error;
        update({ loading: false, error });
        pending = null;
        return error;
      });
    return pending;
  }

  function ensureLoaded(): ResultAsync<ResolutionPreset[], AppError> {
    return snapshot.loaded ? okAsync(snapshot.presets) : reload();
  }

  function savePresets(presets: ResolutionPreset[]): ResultAsync<ResolutionPreset[], AppError> {
    return save(presets)
      .map((saved) => {
        revision += 1;
        pending = null;
        update({ presets: saved, loaded: true, loading: false, error: null });
        return saved;
      })
      .mapErr((error) => {
        if (error.details?.status === 409) {
          revision += 1;
          pending = null;
          update({ loaded: false, loading: false, error });
        }
        return error;
      });
  }

  return { ...readonly(state), ensureLoaded, reload, save: savePresets };
}

export const presetLibrary = createPresetLibrary();
export const presetManagerOpen = writable(false);

export function openResolutionPresetManager() {
  presetManagerOpen.set(true);
}
