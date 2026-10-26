<script lang="ts">
  import { formatAppError } from "@/errors";
  import { presetLibrary, openResolutionPresetManager } from "@/resolution/library";
  import { matchImageDimensions, setAspectRatio, swapOrientation, type EditorState } from "./state";
  import { referenceImageUrl } from "./services";
  import NumberField from "./NumberField.svelte";
  type Ratio = [number, number];
  export let state: EditorState;
  export let onchange: (state: EditorState) => void;
  export let onloadimage: (event: Event) => void;
  export let onclearimage: () => void;
  export let onpasteimage: () => void;
  export let showImage = true;
  export let showGrid = false;
  // Keeps a typed ratio such as 16:9 visible while the snapped size still comes from it.
  let typedRatio: Ratio = [1, 1];
  let imageWidth = 0;
  let imageHeight = 0;
  $: presets = $presetLibrary.presets;
  $: loadingPresets = $presetLibrary.loading;
  $: presetError = $presetLibrary.error ? formatAppError($presetLibrary.error) : "";
  $: locked = state.target_locked;
  $: currentPreset = presets.find((preset) => fits(state, [preset.x, preset.y]))?.name ?? "";
  $: ratio =
    [
      typedRatio,
      ...(imageWidth && imageHeight ? [reducedRatio(imageWidth, imageHeight)] : []),
      ...presets.flatMap((preset): Ratio[] => [
        [preset.x, preset.y],
        [preset.y, preset.x],
      ]),
    ].find((item) => fits(state, item)) ?? reducedRatio(state.width, state.height);
  void presetLibrary.ensureLoaded();

  function fits(current: EditorState, [x, y]: Ratio): boolean {
    const size = setAspectRatio(current, x, y);
    return size.width === current.width && size.height === current.height;
  }
  function reducedRatio(width: number, height: number): Ratio {
    let [a, b] = [width, height];
    while (b) [a, b] = [b, a % b];
    return [width / a, height / a];
  }
  function applyRatio(next: Ratio) {
    typedRatio = next;
    onchange(setAspectRatio(state, ...next));
  }
  function dimension(field: "width" | "height", value: number) {
    const next = { ...state, [field]: Math.max(1, Math.round(value)) };
    onchange({ ...next, megapixels: (next.width * next.height) / 1_000_000 });
  }
  function targetPixels(pixels: number) {
    onchange(setAspectRatio({ ...state, megapixels: pixels / 1_000_000 }, ...ratio));
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
      <div class="reference-meta">
        <p class="filename" title={state.reference_image_name}>{state.reference_image_name}</p>
        {#if imageWidth && imageHeight}<p class="subtle">{imageWidth} × {imageHeight}</p>{/if}
      </div>
      <button type="button" class="quiet danger with-icon" onclick={onclearimage}
        ><svg viewBox="0 0 24 24" aria-hidden="true"
          ><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V4h6v3" /></svg
        >Remove</button
      >
    </div>
  {:else}<p class="subtle">
      Drop, paste or choose an image. The canvas takes its size, or only its ratio when the target is locked.
    </p>{/if}
  <div class="button-row wrap">
    <label class="file-button with-icon"
      ><svg viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg
      >{state.reference_image_path ? "Replace" : "Choose image"}<input
        type="file"
        accept="image/*"
        onchange={onloadimage}
      /></label
    >
    <button type="button" class="with-icon" onclick={onpasteimage}
      ><svg viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" /><rect
          x="9"
          y="2"
          width="6"
          height="5"
          rx="1"
        /></svg
      >Paste</button
    >
    {#if state.reference_image_path}<button
        type="button"
        class="with-icon"
        disabled={!imageWidth || !imageHeight}
        title={locked ? "Match the image's ratio at the locked target" : "Match the image's exact size"}
        onclick={() =>
          onchange(
            locked
              ? setAspectRatio(state, imageWidth, imageHeight)
              : matchImageDimensions(state, imageWidth, imageHeight),
          )}
        ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>{locked
          ? "Match ratio"
          : "Match size"}</button
      >{/if}
  </div>
  {#if state.reference_image_path}<div class="inline-row">
      <label class="inline-label" title="Applies to the canvas preview and output image"
        >Fit<select
          aria-label="Image fitting"
          value={state.reference_image_fit}
          onchange={(event) =>
            onchange({
              ...state,
              reference_image_fit: event.currentTarget.value === "contain" ? "contain" : "stretch",
            })}
        >
          <option value="stretch">Stretch to canvas</option>
          <option value="contain">Fit inside canvas</option>
        </select></label
      >
      <label class="check-label"><input type="checkbox" bind:checked={showImage} />Show image</label>
    </div>{/if}
</section>
<section>
  <div class="section-heading">
    <h2>Size</h2>
    <button type="button" class="quiet" aria-haspopup="dialog" onclick={openResolutionPresetManager}
      >Manage presets</button
    >
  </div>
  <div class="ratio-row">
    <label title="Your saved Resolution Selector presets"
      >Aspect ratio<select
        value={currentPreset}
        disabled={loadingPresets || !!presetError}
        onchange={(event) => {
          const preset = presets.find((item) => item.name === event.currentTarget.value);
          if (preset) applyRatio([preset.x, preset.y]);
        }}
        ><option value="" disabled>{loadingPresets ? "Loading your presets…" : "Custom"}</option
        >{#each presets as preset (preset.name)}<option value={preset.name}
            >{preset.name} · {preset.x}:{preset.y}</option
          >{/each}</select
      ></label
    >
    <button
      type="button"
      class="with-icon"
      title="Swap width and height"
      onclick={() => {
        typedRatio = [ratio[1], ratio[0]];
        onchange(swapOrientation(state));
      }}
      ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" /></svg
      >Swap</button
    >
  </div>
  {#if presetError}<p class="field-error" role="alert">{presetError}</p>
    <button type="button" onclick={() => void presetLibrary.reload()}>Retry loading presets</button>{/if}
  <div class="grid three">
    <NumberField
      label="Ratio width"
      value={ratio[0]}
      min={1}
      onchange={(value) => applyRatio([Math.round(value), ratio[1]])}
    />
    <NumberField
      label="Ratio height"
      value={ratio[1]}
      min={1}
      onchange={(value) => applyRatio([ratio[0], Math.round(value)])}
    />
    <NumberField
      label="Multiple"
      value={state.side_step}
      min={1}
      onchange={(value) => onchange(setAspectRatio({ ...state, side_step: Math.round(value) }, ...ratio))}
    />
  </div>
  <div class="grid two">
    <NumberField
      label="Width"
      value={state.width}
      min={1}
      step={state.side_step}
      disabled={locked}
      onchange={(value) => dimension("width", value)}
    />
    <NumberField
      label="Height"
      value={state.height}
      min={1}
      step={state.side_step}
      disabled={locked}
      onchange={(value) => dimension("height", value)}
    />
  </div>
  <div class="target-row">
    <div class="field">
      <span class="field-label">Target</span>
      <div class="segmented" role="group" aria-label="Size target">
        <button
          type="button"
          class:active={state.size_mode === "megapixels"}
          aria-pressed={state.size_mode === "megapixels"}
          onclick={() => onchange({ ...state, size_mode: "megapixels" })}>Megapixels</button
        ><button
          type="button"
          class:active={state.size_mode === "squared"}
          aria-pressed={state.size_mode === "squared"}
          onclick={() => onchange({ ...state, size_mode: "squared" })}>Squared</button
        >
      </div>
    </div>
    {#if state.size_mode === "squared"}<NumberField
        label="Square side"
        value={Math.round(Math.sqrt(state.megapixels * 1_000_000))}
        min={1}
        step={state.side_step}
        disabled={locked}
        onchange={(value) => targetPixels(value * value)}
      />{:else}<NumberField
        label="Megapixels"
        value={state.megapixels}
        min={0.000001}
        step={0.05}
        disabled={locked}
        onchange={(value) => targetPixels(value * 1_000_000)}
      />{/if}
    <button
      type="button"
      class:active={locked}
      aria-pressed={locked}
      aria-label="Lock target"
      title="Keep this target when loading images or changing the ratio"
      onclick={() => onchange({ ...state, target_locked: !locked })}
      ><svg viewBox="0 0 24 24" aria-hidden="true"
        ><rect x="5" y="11" width="14" height="10" rx="2" /><path
          d={locked ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V7a4 4 0 0 1 7.7-1.5"}
        /></svg
      ></button
    >
  </div>
  <label class="check-label"><input type="checkbox" bind:checked={showGrid} />Show canvas grid</label>
</section>

<style>
  .reference-summary {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 10px;
  }
  .reference-summary .reference-thumbnail {
    width: 44px;
    height: 44px;
    margin: 0;
    flex-shrink: 0;
  }
  .reference-meta {
    flex: 1;
    min-width: 0;
  }
  .reference-meta p {
    margin: 0;
  }
  .reference-meta .filename {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .inline-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .inline-row .inline-label {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    flex: 1;
    margin: 0;
  }
  .inline-row .check-label {
    margin: 0;
  }
  .target-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: end;
  }
  .target-row > button {
    height: 38px;
    margin-bottom: 12px;
  }
  .target-row > button svg {
    width: 16px;
    height: 16px;
  }
  .with-icon {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  svg {
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .field {
    display: grid;
    gap: 5px;
    margin-bottom: 12px;
  }
  .segmented {
    display: flex;
  }
  .segmented button {
    flex: 1;
    height: 38px;
  }
  .segmented button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .segmented button:last-child {
    border-radius: 0 6px 6px 0;
    margin-left: -1px;
  }
</style>
