<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { on } from "svelte/events";
  import { ResultAsync } from "neverthrow";
  import {
    colorLibrary,
    colorLibraryError,
    hexToHsv,
    hsvToHex,
    loadColorLibrary,
    parseColor,
    rememberColor,
    toggleFavorite,
    type Hsv,
  } from "./colors";
  export let label: string;
  export let colors: string[];
  export let limit: number;
  export let onchange: (colors: string[]) => void;
  const defaultColor = "#B99B63";
  const EyeDropper = window.EyeDropper;
  let active: number | null = null;
  let openedWith = "";
  let hsv: Hsv = hexToHsv(defaultColor);
  let hexText = "";
  let dragging = false;
  let hexInput: HTMLInputElement | undefined;
  let swatchRow: HTMLDivElement | undefined;
  let swatches: HTMLButtonElement[] = [];
  $: current = active === null ? null : (colors.at(active) ?? null);
  $: sync(current);
  $: draft = hsvToHex(hsv);
  $: favorite = !!current && $colorLibrary.favorites.includes(current);

  function sync(color: string | null) {
    if (!color) return;
    if (color !== hsvToHex(hsv)) hsv = hexToHsv(color);
    hexText = color;
  }
  function commit(color: string) {
    if (active === null) return;
    const index = active;
    onchange(colors.map((item, i) => (i === index ? color : item)));
  }
  function setHsv(next: Hsv) {
    hsv = next;
    hexText = hsvToHex(next);
  }
  /** Applies a typed but uncommitted hex code and records the final color in the history. */
  function finish() {
    if (!current) return;
    const typed = parseColor(hexText);
    if (typed && typed !== current) commit(typed);
    const color = typed ?? current;
    if (color !== openedWith) rememberColor(color);
  }
  async function open(index: number, color: string) {
    finish();
    active = index;
    openedWith = color;
    await tick();
    hexInput?.select();
  }
  function close(restoreFocus: boolean) {
    if (active === null) return;
    const index = active;
    finish();
    active = null;
    if (restoreFocus) swatches[index]?.focus();
  }
  function remove(index: number) {
    if (active === index) active = null;
    onchange(colors.filter((_, i) => i !== index));
  }
  function add(color: string) {
    onchange([...colors, color]);
    void open(colors.length, color);
  }
  function pickArea(event: PointerEvent) {
    const box = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    if (!box) return;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    setHsv({
      h: hsv.h,
      s: clamp((event.clientX - box.left) / box.width),
      v: 1 - clamp((event.clientY - box.top) / box.height),
    });
  }
  function nudgeArea(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.1 : 0.02;
    const ds = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dv = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
    if (!ds && !dv) return;
    event.preventDefault();
    setHsv({ h: hsv.h, s: Math.max(0, Math.min(1, hsv.s + ds)), v: Math.max(0, Math.min(1, hsv.v + dv)) });
    commit(draft);
  }
  async function pickFromScreen() {
    if (!EyeDropper) return;
    const result = await ResultAsync.fromPromise(new EyeDropper().open(), () => null);
    const color = result.isOk() ? parseColor(result.value.sRGBHex) : null;
    if (color) commit(color);
  }
  function popover(element: HTMLElement) {
    // Float over the editor so the sidebar's scroll area never clips the picker.
    const place = () => {
      const anchor = active === null ? null : swatches[active]?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 8;
      const { width, height } = element.getBoundingClientRect();
      const below = anchor.bottom + 6;
      const top = below + height <= innerHeight - margin ? below : anchor.top - 6 - height;
      element.style.left = `${Math.max(margin, Math.min(anchor.left, innerWidth - width - margin))}px`;
      element.style.top = `${Math.max(margin, top)}px`;
    };
    const observer = new ResizeObserver(place);
    observer.observe(element);
    const listeners = [
      on(window, "resize", place),
      on(window, "scroll", place, { capture: true }),
      on(
        document,
        "pointerdown",
        (event) => {
          const target = event.target;
          if (target instanceof Node && !element.contains(target) && !swatchRow?.contains(target)) close(false);
        },
        { capture: true },
      ),
      // Keep picker keys away from the editor shortcuts: Escape closes the picker, not the editor.
      on(element, "keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(true);
        }
        if (["Escape", "Delete", "Backspace"].includes(event.key)) event.stopPropagation();
      }),
    ];
    place();
    return {
      destroy() {
        observer.disconnect();
        listeners.forEach((remove) => remove());
      },
    };
  }
  onMount(loadColorLibrary);
  onDestroy(finish);
</script>

<div class="palette-field">
  <span class="field-label">{label}</span>
  <div class="palette-swatches" bind:this={swatchRow}>
    {#each colors as color, index (index)}
      <button
        bind:this={swatches[index]}
        type="button"
        class="color-swatch"
        class:active={active === index}
        style={`--swatch: ${active === index ? draft : color}`}
        title={`${color} — right-click or Delete to remove`}
        aria-label={`${label} color ${index + 1}: ${color}`}
        aria-expanded={active === index}
        onclick={() => (active === index ? close(true) : open(index, color))}
        onkeydown={(event) => {
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            event.stopPropagation();
            remove(index);
          }
        }}
        oncontextmenu={(event) => {
          event.preventDefault();
          remove(index);
        }}
      ></button>
    {/each}
    {#if colors.length < limit}
      <button
        type="button"
        class="swatch-add"
        aria-label={`Add ${label.toLowerCase()} color`}
        onclick={() => add($colorLibrary.recent[0] ?? defaultColor)}>+</button
      >
    {/if}
  </div>
  {#if active !== null && current}
    <div class="color-picker" role="group" aria-label={`Edit ${label.toLowerCase()} color ${active + 1}`} use:popover>
      <div
        class="color-area"
        role="slider"
        tabindex="0"
        aria-label="Saturation and brightness"
        aria-valuenow={Math.round(hsv.v * 100)}
        aria-valuetext={draft}
        style={`--hue: ${hsv.h}`}
        onpointerdown={(event) => {
          dragging = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          pickArea(event);
        }}
        onpointermove={(event) => dragging && pickArea(event)}
        onpointerup={() => {
          dragging = false;
          commit(draft);
        }}
        onpointercancel={() => {
          dragging = false;
          if (current) sync(current);
        }}
        onkeydown={nudgeArea}
      >
        <span class="color-thumb" style={`left: ${hsv.s * 100}%; top: ${(1 - hsv.v) * 100}%; background: ${draft}`}
        ></span>
      </div>
      <div class="picker-row">
        <input
          class="hue-slider"
          type="range"
          aria-label="Hue"
          min="0"
          max="359"
          value={Math.round(hsv.h)}
          oninput={(event) => setHsv({ ...hsv, h: event.currentTarget.valueAsNumber })}
          onchange={() => commit(draft)}
        />
        {#if EyeDropper}<button
            type="button"
            class="quiet icon-button"
            aria-label="Pick color from screen"
            title="Pick color from screen"
            onclick={pickFromScreen}
            ><svg viewBox="0 0 16 16" aria-hidden="true"
              ><path d="M10.5 2.5l3 3M9 4l3 3-6.5 6.5H2.5v-3z M11.8 1.7a1.4 1.4 0 0 1 2 2L12 5.5 10.5 4z" /></svg
            ></button
          >{/if}
      </div>
      <div class="picker-row">
        <input
          bind:this={hexInput}
          class="hex-input"
          aria-label="Hex color"
          title="Hex code or RGB, such as 166, 73, 63"
          spellcheck="false"
          autocomplete="off"
          value={hexText}
          oninput={(event) => {
            hexText = event.currentTarget.value;
            const color = parseColor(hexText);
            // Pasted values convert at once; typed ones wait for Enter or blur unless they are a full hex code.
            const pasted = event instanceof InputEvent && event.inputType === "insertFromPaste";
            if (!color || (!pasted && !/^#?[0-9a-f]{6}$/i.test(hexText.trim()))) return;
            commit(color);
            hexText = color;
          }}
          onchange={() => {
            const color = parseColor(hexText);
            if (color) commit(color);
            hexText = color ?? current ?? hexText;
          }}
          onkeydown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <button
          type="button"
          class="quiet icon-button"
          class:favorite
          aria-pressed={favorite}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          onclick={() => current && toggleFavorite(current)}
          ><svg viewBox="0 0 16 16" aria-hidden="true"
            ><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" /></svg
          ></button
        >
        <button type="button" class="quiet danger" onclick={() => active !== null && remove(active)}>Remove</button>
      </div>
      {#if $colorLibrary.favorites.length}
        <div class="library" role="group" aria-label="Favorite colors">
          <span>Favorites</span>
          <div>
            {#each $colorLibrary.favorites as color (color)}<button
                type="button"
                class="library-swatch"
                style={`--swatch: ${color}`}
                title={`${color} — right-click to unfavorite`}
                aria-label={`Use favorite color ${color}`}
                onclick={() => commit(color)}
                oncontextmenu={(event) => {
                  event.preventDefault();
                  toggleFavorite(color);
                }}
              ></button>{/each}
          </div>
        </div>
      {/if}
      {#if $colorLibrary.recent.length}
        <div class="library" role="group" aria-label="Recent colors">
          <span>Recent</span>
          <div>
            {#each $colorLibrary.recent as color (color)}<button
                type="button"
                class="library-swatch"
                style={`--swatch: ${color}`}
                title={color}
                aria-label={`Use recent color ${color}`}
                onclick={() => commit(color)}
              ></button>{/each}
          </div>
        </div>
      {/if}
      {#if $colorLibraryError}<p class="field-error">{$colorLibraryError}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .color-swatch,
  .library-swatch {
    background: var(--swatch);
    border: 1px solid #fff3;
  }
  .color-swatch:hover,
  .library-swatch:hover {
    background: var(--swatch);
    border-color: var(--text-2);
  }
  .color-swatch.active {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .color-picker {
    position: fixed;
    z-index: 6;
    display: grid;
    gap: 8px;
    width: 248px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 10px;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: 0 8px 24px #0008;
  }
  .color-area {
    position: relative;
    flex-shrink: 0;
    height: 132px;
    border-radius: 6px;
    background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(var(--hue) 100% 50%));
    cursor: crosshair;
    touch-action: none;
  }
  .color-area:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .color-thumb {
    position: absolute;
    width: 14px;
    height: 14px;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px #0008;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .picker-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .hue-slider {
    flex: 1;
    height: 12px;
    margin-right: 4px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    appearance: none;
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  }
  .hue-slider::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: transparent;
    box-shadow: 0 0 0 1px #0008;
  }
  .hue-slider::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: transparent;
    box-shadow: 0 0 0 1px #0008;
  }
  .icon-button {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    padding: 0;
  }
  .icon-button svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linejoin: round;
  }
  .icon-button.favorite {
    color: var(--accent);
  }
  .icon-button.favorite svg {
    fill: currentColor;
  }
  .hex-input {
    flex: 1;
    padding: 5px 8px;
    font:
      13px/1.4 ui-monospace,
      monospace;
    text-transform: uppercase;
  }
  .library {
    display: grid;
    gap: 4px;
    font-size: 11px;
    color: var(--muted);
  }
  .library div {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .library-swatch {
    padding: 0;
    width: 18px;
    height: 18px;
    border-radius: 4px;
  }
</style>
