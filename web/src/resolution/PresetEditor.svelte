<script lang="ts">
  import { onMount, tick } from "svelte";
  import { on } from "svelte/events";
  import { formatAppError } from "@/errors";
  import { presetLibrary } from "./library";
  import type { ResolutionPreset } from "./presets";

  export let oncancel: () => void;
  let dialog: HTMLDialogElement;
  let mounted = false;
  onMount(() => {
    mounted = true;
    const opener = document.activeElement;
    dialog.showModal();
    void load();
    // Let the native modal own focus and keyboard navigation, without editor shortcuts.
    const keydown = on(dialog, "keydown", (event) => {
      if (event.key === "Tab") {
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"),
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      event.stopPropagation();
    });
    const keyup = on(dialog, "keyup", (event) => event.stopPropagation());
    const removeInputListeners = ["keypress", "paste", "copy", "cut"].map((type) =>
      on(dialog, type, (event) => event.stopPropagation()),
    );
    return () => {
      mounted = false;
      keydown();
      keyup();
      for (const remove of removeInputListeners) remove();
      dialog.close();
      void tick().then(() => {
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
      });
    };
  });
  async function add() {
    drafts = [...drafts, { id: crypto.randomUUID(), name: "", x: 1, y: 1 }];
    await tick();
    dialog.querySelector<HTMLInputElement>(`input[aria-label="Preset ${drafts.length} name"]`)?.focus();
  }
  let drafts: (ResolutionPreset & { id: string })[] = [];
  let saved: ResolutionPreset[] = [];
  let loading = true;
  let saving = false;
  let error = "";
  let conflict = false;
  let confirmReload = false;
  let announcement = "";
  let draggingId: string | null = null;
  let dropTarget: { id: string; after: boolean } | null = null;
  const presetName = ({ name, x, y }: ResolutionPreset): string => name.trim() || `${x}:${y}`;
  $: entries = drafts.map((draft) => ({ name: presetName(draft), x: draft.x, y: draft.y }));
  $: dirty = JSON.stringify(entries) !== JSON.stringify(saved);
  $: duplicates = new Set(
    entries
      .filter((entry, index) => entries.findIndex((other) => other.name === entry.name) !== index)
      .map((entry) => entry.name),
  );
  async function load(retry = false) {
    loading = true;
    error = "";
    const result = await (retry ? presetLibrary.reload() : presetLibrary.ensureLoaded());
    if (!mounted) return;
    loading = false;
    if (result.isErr()) error = formatAppError(result.error);
    else {
      saved = result.value;
      drafts = result.value.map((preset) => ({ ...preset, id: crypto.randomUUID() }));
      conflict = false;
      confirmReload = false;
    }
  }
  async function save() {
    if (saving || loading || conflict || !drafts.length) return;
    saving = true;
    error = "";
    const result = await presetLibrary.save(entries);
    if (!mounted) return;
    saving = false;
    if (result.isErr()) {
      error = formatAppError(result.error);
      conflict = result.error.details?.status === 409;
    } else oncancel();
  }
  async function move(index: number, target: number) {
    if (saving || index === target || target < 0 || target >= drafts.length) return;
    const focused = document.activeElement;
    const next = [...drafts];
    const [preset] = next.splice(index, 1);
    if (!preset) return;
    next.splice(target, 0, preset);
    drafts = next;
    announcement = `${presetName(preset)} moved to position ${target + 1} of ${drafts.length}.`;
    await tick();
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
  }
  function swap(index: number) {
    drafts = drafts.map((draft, position) =>
      position === index
        ? {
            ...draft,
            name: draft.name.trim() === `${draft.x}:${draft.y}` ? `${draft.y}:${draft.x}` : draft.name,
            x: draft.y,
            y: draft.x,
          }
        : draft,
    );
  }
  function dragOver(event: DragEvent, id: string) {
    if (!draggingId || saving) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    dropTarget = draggingId === id || !bounds ? null : { id, after: event.clientY > bounds.top + bounds.height / 2 };
  }
  function clearDrag() {
    draggingId = null;
    dropTarget = null;
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (draggingId && dropTarget && !saving) {
      const index = drafts.findIndex((preset) => preset.id === draggingId);
      const slot = drafts.findIndex((preset) => preset.id === dropTarget?.id) + (dropTarget.after ? 1 : 0);
      if (index >= 0) void move(index, slot - (index < slot ? 1 : 0));
    }
    clearDrag();
  }
</script>

<dialog
  bind:this={dialog}
  class="preset-modal neriss-editor-theme"
  aria-label="Manage aspect-ratio presets"
  oncancel={(event) => {
    event.preventDefault();
    if (!saving) oncancel();
  }}
>
  <form
    class="preset-editor"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <header>
      <div>
        <h2>Aspect-ratio presets</h2>
        <p>Shared with Resolution Selector</p>
      </div>
      <div class="button-row">
        {#if dirty}<span class="status">Unsaved changes</span>{/if}
        <button type="button" class="quiet" disabled={saving} onclick={oncancel}>Cancel</button>
        <button type="submit" class="save-presets" disabled={saving || loading || conflict || !drafts.length}
          >{saving ? "Saving…" : "Save presets"}</button
        >
      </div>
    </header>
    {#if (error && drafts.length) || conflict}
      <div class="feedback">
        {#if error && drafts.length}<p class="field-error" role="alert">{error}</p>{/if}
        {#if conflict}
          <p>Your draft has not been saved or replaced. Reload the latest presets before saving again.</p>
          {#if confirmReload}
            <p>Reloading discards this draft and replaces it with the server's latest presets.</p>
            <div class="button-row">
              <button type="button" disabled={loading} onclick={() => (confirmReload = false)}>Keep draft</button>
              <button type="button" disabled={loading} onclick={() => void load(true)}
                >{loading ? "Reloading…" : "Discard draft and reload"}</button
              >
            </div>
          {:else}
            <button type="button" onclick={() => (confirmReload = true)}>Reload latest presets</button>
          {/if}
        {/if}
      </div>
    {/if}
    <div class="preset-rows" role="group" aria-label="Presets" aria-disabled={saving} aria-busy={loading}>
      {#if loading}
        <p role="status">Loading your presets…</p>
      {:else if !drafts.length}
        <p class="field-error" role="alert">{error}</p>
        <button type="button" onclick={() => void load(true)}>Retry loading presets</button>
      {:else}
        {#each drafts as draft, index (draft.id)}
          <div
            class="preset-draft"
            class:dragging={draggingId === draft.id}
            class:drop-before={dropTarget?.id === draft.id && !dropTarget.after}
            class:drop-after={dropTarget?.id === draft.id && dropTarget.after}
            role="group"
            aria-label={`Preset ${index + 1}`}
            ondragover={(event) => dragOver(event, draft.id)}
            ondragleave={(event) => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
                dropTarget = null;
            }}
            ondrop={drop}
          >
            <button
              type="button"
              class="quiet drag-handle"
              draggable={!saving}
              disabled={saving}
              aria-label={`Drag to reorder preset ${index + 1}`}
              title="Drag to reorder; use ↑ or ↓ when focused"
              ondragstart={(event) => {
                draggingId = draft.id;
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", draft.id);
                  if (event.currentTarget.parentElement)
                    event.dataTransfer.setDragImage(event.currentTarget.parentElement, 12, 12);
                }
                event.stopPropagation();
              }}
              ondragend={clearDrag}
              onkeydown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                event.preventDefault();
                void move(index, index + (event.key === "ArrowUp" ? -1 : 1));
              }}>⠿</button
            >
            <span class="ratio-shape" aria-hidden="true"
              ><span
                style:width={`${(18 * draft.x) / Math.max(draft.x, draft.y)}px`}
                style:height={`${(18 * draft.y) / Math.max(draft.x, draft.y)}px`}
              ></span></span
            >
            <input
              aria-label={`Preset ${index + 1} name`}
              aria-invalid={duplicates.has(presetName(draft))}
              title={duplicates.has(presetName(draft)) ? "Another preset has this name" : undefined}
              bind:value={draft.name}
              placeholder={`${draft.x}:${draft.y}`}
              disabled={saving}
            />
            <div class="ratio">
              <input
                type="number"
                aria-label={`Preset ${index + 1} width`}
                bind:value={draft.x}
                min="1"
                max="100000"
                step="1"
                required
                disabled={saving}
              /><span aria-hidden="true">:</span><input
                type="number"
                aria-label={`Preset ${index + 1} height`}
                bind:value={draft.y}
                min="1"
                max="100000"
                step="1"
                required
                disabled={saving}
              />
            </div>
            <button
              type="button"
              class="quiet icon-button"
              disabled={saving || draft.x === draft.y}
              aria-label={`Swap preset ${index + 1} orientation`}
              title="Swap orientation"
              onclick={() => swap(index)}
              ><svg viewBox="0 0 24 24" aria-hidden="true"
                ><path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" /></svg
              ></button
            >
            <button
              type="button"
              class="quiet icon-button delete"
              disabled={saving || drafts.length === 1}
              aria-label={`Delete preset ${index + 1}`}
              title="Delete preset"
              onclick={() => (drafts = drafts.filter((_, position) => position !== index))}
              ><svg viewBox="0 0 24 24" aria-hidden="true"
                ><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg
              ></button
            >
          </div>
        {/each}
      {/if}
    </div>
    {#if drafts.length}
      <button type="button" class="add-preset" disabled={saving || loading} onclick={add}
        ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Add preset</button
      >
    {/if}
    <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
  </form>
</dialog>

<style>
  .preset-modal {
    pointer-events: auto;
    width: min(600px, calc(100vw - 32px));
    max-width: none;
    max-height: calc(100dvh - 32px);
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface-1);
    box-shadow: 0 24px 80px #0008;
  }
  .preset-modal::backdrop {
    background: var(--backdrop);
  }
  .preset-editor {
    display: flex;
    flex-direction: column;
    max-height: min(720px, calc(100dvh - 36px));
  }
  header,
  .feedback {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 14px 16px 14px 20px;
  }
  header h2 {
    font-size: 16px;
    margin: 0;
  }
  header p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  header .button-row {
    margin-left: auto;
  }
  .status {
    font-size: 12px;
    color: var(--muted);
  }
  .preset-modal .save-presets {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
    font-weight: 500;
  }
  .preset-modal .save-presets:hover {
    filter: brightness(1.08);
  }
  .feedback {
    padding: 10px 20px;
    font-size: 12px;
  }
  .feedback p {
    margin: 0 0 8px;
    color: var(--muted);
  }
  .feedback .field-error {
    color: var(--danger);
  }
  .feedback .button-row {
    flex-wrap: wrap;
  }
  .preset-rows {
    padding: 8px 12px 0;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .preset-draft {
    position: relative;
    display: grid;
    grid-template-columns: 20px 24px minmax(0, 1fr) auto 28px 28px;
    gap: 8px;
    align-items: center;
    padding: 4px 6px;
    border-radius: 8px;
  }
  .preset-draft:is(:hover, :focus-within) {
    background: var(--surface-2);
  }
  .preset-draft.dragging {
    opacity: 0.45;
  }
  .preset-draft.drop-before::before,
  .preset-draft.drop-after::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
    pointer-events: none;
  }
  .preset-draft.drop-before::before {
    top: 0;
  }
  .preset-draft.drop-after::after {
    bottom: 0;
  }
  .preset-modal .drag-handle {
    cursor: grab;
    padding: 4px 0;
    font-size: 16px;
    color: var(--placeholder);
  }
  .preset-draft:hover .drag-handle {
    color: var(--muted);
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .ratio-shape {
    display: grid;
    place-items: center;
    height: 24px;
  }
  .ratio-shape span {
    min-width: 3px;
    min-height: 3px;
    border: 1.5px solid var(--accent-line);
    border-radius: 2px;
    background: var(--accent-bg);
  }
  .preset-draft input {
    padding: 5px 8px;
    background: transparent;
    border-color: transparent;
  }
  .preset-draft:is(:hover, :focus-within) input {
    background: var(--field);
    border-color: var(--border);
  }
  .preset-draft input[aria-invalid="true"] {
    border-color: var(--danger);
  }
  .ratio {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--placeholder);
  }
  .ratio input {
    width: 56px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    appearance: textfield;
  }
  .ratio input::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }
  .preset-modal .icon-button {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    color: var(--muted);
    opacity: 0;
  }
  .preset-draft:is(:hover, :focus-within) .icon-button {
    opacity: 1;
  }
  .preset-draft:is(:hover, :focus-within) .icon-button:disabled {
    opacity: 0.38;
  }
  .preset-modal .icon-button:hover {
    color: var(--text);
  }
  .preset-modal .delete:hover {
    color: var(--danger);
  }
  svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex-shrink: 0;
  }
  .preset-modal .add-preset {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    margin: 6px 18px 16px;
    padding: 8px 12px;
    border-style: dashed;
    background: transparent;
    color: var(--muted);
  }
  .preset-modal .add-preset:hover {
    background: var(--accent-bg);
    color: var(--accent);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  @media (hover: none) {
    .preset-modal .icon-button {
      opacity: 1;
    }
    .preset-modal .icon-button:disabled {
      opacity: 0.38;
    }
  }
  @media (max-width: 560px) {
    header {
      padding: 12px;
    }
    .feedback {
      padding: 10px 12px;
    }
    .preset-rows {
      padding: 6px 6px 0;
    }
    .preset-draft {
      grid-template-columns: 16px 20px minmax(0, 1fr) auto 28px 28px;
      gap: 4px;
      padding: 4px;
    }
    .ratio input {
      width: 44px;
      padding: 5px 4px;
    }
    .preset-modal .add-preset {
      margin: 6px 10px 12px;
    }
  }
</style>
