<script lang="ts">
  import { onMount } from "svelte";
  import { cloneStyle, type EditorState, type EditorStyle, type StylePreset } from "@/editor/state";
  import { inputValue } from "@/editor/services";
  import { loadStylePresets, saveStylePresets } from "@/editor/presets";
  import TextField from "@/editor/TextField.svelte";
  import PaletteField from "@/editor/PaletteField.svelte";
  import { editorErrors, type AppError } from "@/errors";

  export let state: EditorState;
  export let onchange: (state: EditorState) => void;
  export let onerror: (error: AppError) => void;
  export let onnotice: (message: string) => void;
  let presets: StylePreset[] = [];
  let presetName = "";
  let loaded = false;
  let loading = false;
  let saving = false;

  function loadPresets() {
    if (loading || saving) return;
    loading = true;
    loaded = false;
    void loadStylePresets().match(
      (value) => {
        presets = value;
        loaded = true;
        loading = false;
      },
      (error) => {
        loading = false;
        onerror(error);
      },
    );
  }
  onMount(loadPresets);

  function updateStyle(update: Partial<EditorStyle>) {
    onchange({ ...state, style_description: { ...state.style_description, ...update } });
  }
  async function savePreset() {
    if (!loaded || saving) return;
    const name = presetName.trim();
    if (!name) {
      onerror(editorErrors.runtime("Preset name is required"));
      return;
    }
    const next = [
      ...presets.filter((preset) => preset.name !== name),
      { id: crypto.randomUUID(), name, style: cloneStyle(state.style_description) },
    ];
    saving = true;
    const result = await saveStylePresets(next);
    saving = false;
    if (result.isErr()) {
      loaded = false;
      onerror(result.error);
      return;
    }
    presets = next;
    presetName = "";
    onnotice("Saved style preset.");
  }
  async function deletePreset(id: string) {
    if (!loaded || saving) return;
    const next = presets.filter((preset) => preset.id !== id);
    saving = true;
    const result = await saveStylePresets(next);
    saving = false;
    if (result.isErr()) {
      loaded = false;
      onerror(result.error);
      return;
    }
    presets = next;
    onnotice("Deleted style preset.");
  }
</script>

<section>
  <h2>Image Brief</h2>
  <TextField
    label="High-level description"
    value={state.high_level_description}
    placeholder="Describe the overall scene…"
    onchange={(high_level_description) => onchange({ ...state, high_level_description })}
  />
  <TextField
    label="Background"
    value={state.background}
    placeholder="Describe the background…"
    onchange={(background) => onchange({ ...state, background })}
  />
</section>
<section>
  <h2>Style</h2>
  <label
    >Mode
    <select
      value={state.style_description.mode}
      onchange={(event) => updateStyle({ mode: inputValue(event) === "photo" ? "photo" : "art" })}
    >
      <option value="art">Art style</option><option value="photo">Photo</option>
    </select>
  </label>
  <label
    >Aesthetics <input
      value={state.style_description.aesthetics}
      oninput={(event) => updateStyle({ aesthetics: inputValue(event) })}
    /></label
  >
  <label
    >Lighting <input
      value={state.style_description.lighting}
      oninput={(event) => updateStyle({ lighting: inputValue(event) })}
    /></label
  >
  <label
    >Medium <input
      value={state.style_description.medium}
      oninput={(event) => updateStyle({ medium: inputValue(event) })}
    /></label
  >
  {#if state.style_description.mode === "photo"}
    <label
      >Photo <input
        value={state.style_description.photo}
        oninput={(event) => updateStyle({ photo: inputValue(event) })}
      /></label
    >
  {:else}
    <label
      >Art style <input
        value={state.style_description.art_style}
        oninput={(event) => updateStyle({ art_style: inputValue(event) })}
      /></label
    >
  {/if}
  <PaletteField
    label="Style palette"
    colors={state.style_description.color_palette}
    limit={16}
    onchange={(color_palette) => updateStyle({ color_palette })}
  />
  <div class="preset-row">
    <input placeholder="Preset name" bind:value={presetName} /><button
      type="button"
      disabled={!loaded || saving}
      onclick={savePreset}>Save</button
    >
  </div>
  {#if !loaded}<button type="button" disabled={loading || saving} onclick={loadPresets}>Reload style presets</button
    >{/if}
  <div class="preset-list">
    {#each presets as preset (preset.id)}
      <button
        type="button"
        onclick={() => {
          updateStyle(cloneStyle(preset.style));
          onnotice(`Applied style preset ${preset.name}.`);
        }}>{preset.name}</button
      >
      <button type="button" class="danger" disabled={saving} onclick={() => deletePreset(preset.id)}>Delete</button>
    {/each}
  </div>
</section>
