<script lang="ts">
  import { formatAppError } from "@/errors";
  import { presetLibrary, openResolutionPresetManager } from "@/resolution/library";
  import { matchImageDimensions, setAspectRatio, swapOrientation, type EditorState } from "./state";
  import { referenceImageUrl } from "./services";
  import NumberField from "./NumberField.svelte";
  export let state: EditorState;
  export let onchange: (state: EditorState) => void;
  export let onloadimage: (event: Event) => void;
  export let onclearimage: () => void;
  export let onpasteimage: () => void;
  export let showImage = true;
  export let showGrid = false;
  let ratioWidth = 1;
  let ratioHeight = 1;
  let imageWidth = 0;
  let imageHeight = 0;
  $: presets = $presetLibrary.presets;
  $: loadingPresets = $presetLibrary.loading;
  $: presetError = $presetLibrary.error ? formatAppError($presetLibrary.error) : "";
  $: currentPreset =
    presets.find((preset) => {
      const dimensions = setAspectRatio(state, preset.x, preset.y);
      return dimensions.width === state.width && dimensions.height === state.height;
    })?.name ?? "";
  void presetLibrary.ensureLoaded();
  function dimension(field: "width" | "height", value: number) {
    const next = { ...state, [field]: Math.max(1, Math.round(value)) };
    onchange({ ...next, megapixels: (next.width * next.height) / 1_000_000 });
  }
</script>

<section>
  <h2>Reference image</h2>
  {#if state.reference_image_path}
    <div class="reference-summary">
      <img
        class="reference-thumbnail"
        src={referenceImageUrl(state.reference_image_path)}
        alt={state.reference_image_name ?? "Reference image"}
        onload={(event) => {
          if (event.currentTarget instanceof HTMLImageElement) {
            imageWidth = event.currentTarget.naturalWidth;
            imageHeight = event.currentTarget.naturalHeight;
          }
        }}
      />
      <p class="subtle filename">{state.reference_image_name}</p>
    </div>
    <label
      >Image fitting<select
        aria-label="Image fitting"
        value={state.reference_image_fit}
        onchange={(event) =>
          onchange({ ...state, reference_image_fit: event.currentTarget.value === "contain" ? "contain" : "stretch" })}
      >
        <option value="stretch">Stretch to canvas</option>
        <option value="contain">Fit inside canvas</option>
      </select></label
    >
    <p class="subtle">Applies to the canvas preview and output image.</p>
    <div class="button-row wrap">
      <button
        type="button"
        disabled={!imageWidth || !imageHeight}
        onclick={() => onchange(matchImageDimensions(state, imageWidth, imageHeight))}>Match image ratio</button
      >
      <button type="button" class="quiet danger" onclick={onclearimage}>Remove</button>
    </div>
    <label class="check-label"><input type="checkbox" bind:checked={showImage} />Show reference image</label>
  {:else}<p class="subtle">
      Drop an image onto the canvas, paste it, or choose a file. The canvas automatically matches its dimensions.
    </p>{/if}
  <div class="button-row wrap">
    <label class="file-button"
      >{state.reference_image_path ? "Replace image" : "Choose image"}<input
        type="file"
        accept="image/*"
        onchange={onloadimage}
      /></label
    >
    <button type="button" onclick={onpasteimage}>Paste image</button>
  </div>
</section>
<section>
  <div class="section-heading">
    <h2>Size &amp; aspect ratio</h2>
    <button type="button" class="quiet" aria-haspopup="dialog" onclick={openResolutionPresetManager}
      >Manage presets</button
    >
  </div>
  <div class="ratio-row">
    <label
      >Aspect ratio<select
        value={currentPreset}
        disabled={loadingPresets || !!presetError}
        onchange={(event) => {
          const preset = presets.find((item) => item.name === event.currentTarget.value);
          if (preset) onchange(setAspectRatio(state, preset.x, preset.y));
        }}
        ><option value="" disabled>{loadingPresets ? "Loading your presets…" : "Choose a preset…"}</option
        >{#each presets as preset (preset.name)}<option value={preset.name}
            >{preset.name} · {preset.x}:{preset.y}</option
          >{/each}</select
      ></label
    >
    <button type="button" title="Swap width and height" onclick={() => onchange(swapOrientation(state))}>↔ Swap</button>
  </div>
  {#if presetError}<p class="field-error" role="alert">{presetError}</p>
    <button type="button" onclick={() => void presetLibrary.reload()}>Retry loading presets</button>
  {:else}<p class="subtle">Your saved Resolution Selector presets.</p>{/if}
  <div class="grid two">
    <NumberField
      label="Width"
      value={state.width}
      min={1}
      step={state.side_step}
      onchange={(value) => dimension("width", value)}
    />
    <NumberField
      label="Height"
      value={state.height}
      min={1}
      step={state.side_step}
      onchange={(value) => dimension("height", value)}
    />
  </div>
  <NumberField
    label="Megapixels"
    value={state.megapixels}
    min={0.000001}
    step={0.05}
    onchange={(value) => onchange(setAspectRatio({ ...state, megapixels: value }, state.width, state.height))}
  />
  <details>
    <summary>Advanced sizing</summary>
    <div class="detail-content">
      <div class="grid two">
        <NumberField
          label="Ratio width"
          value={ratioWidth}
          min={1}
          onchange={(value) => (ratioWidth = value)}
        /><NumberField label="Ratio height" value={ratioHeight} min={1} onchange={(value) => (ratioHeight = value)} />
      </div>
      <button type="button" onclick={() => onchange(setAspectRatio(state, ratioWidth, ratioHeight))}>Apply ratio</button
      >
      <div class="grid two detail-content">
        <NumberField
          label="Dimension multiple"
          value={state.side_step}
          min={1}
          onchange={(value) => onchange({ ...state, side_step: Math.round(value) })}
        />
      </div>
      <p class="subtle">Aspect-ratio presets keep the megapixel target and round dimensions to this multiple.</p>
    </div>
  </details>
  <label class="check-label"><input type="checkbox" bind:checked={showGrid} />Show canvas grid</label>
</section>

<style>
  .reference-summary {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 12px;
  }
  .reference-summary .reference-thumbnail {
    width: 64px;
    height: 64px;
    margin: 0;
    flex-shrink: 0;
  }
  .reference-summary .filename {
    overflow-wrap: anywhere;
    min-width: 0;
  }
</style>
