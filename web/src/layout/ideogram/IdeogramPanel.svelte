<script lang="ts">
  import type { EditorState, EditorStyle } from "@/layout/state";
  import TextField from "@/layout/TextField.svelte";
  import PaletteField from "@/layout/PaletteField.svelte";

  export let state: EditorState;
  export let onchange: (state: EditorState) => void;

  function updateStyle(update: Partial<EditorStyle>) {
    onchange({ ...state, style_description: { ...state.style_description, ...update } });
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
      onchange={(event) => updateStyle({ mode: event.currentTarget.value === "photo" ? "photo" : "art" })}
    >
      <option value="art">Art style</option><option value="photo">Photo</option>
    </select>
  </label>
  <label
    >Aesthetics <input
      value={state.style_description.aesthetics}
      oninput={(event) => updateStyle({ aesthetics: event.currentTarget.value })}
    /></label
  >
  <label
    >Lighting <input
      value={state.style_description.lighting}
      oninput={(event) => updateStyle({ lighting: event.currentTarget.value })}
    /></label
  >
  <label
    >Medium <input
      value={state.style_description.medium}
      oninput={(event) => updateStyle({ medium: event.currentTarget.value })}
    /></label
  >
  {#if state.style_description.mode === "photo"}
    <label
      >Photo <input
        value={state.style_description.photo}
        oninput={(event) => updateStyle({ photo: event.currentTarget.value })}
      /></label
    >
  {:else}
    <label
      >Art style <input
        value={state.style_description.art_style}
        oninput={(event) => updateStyle({ art_style: event.currentTarget.value })}
      /></label
    >
  {/if}
  <PaletteField
    label="Style palette"
    colors={state.style_description.color_palette}
    limit={16}
    onchange={(color_palette) => updateStyle({ color_palette })}
  />
</section>
