<script lang="ts">
  import { onMount, tick } from "svelte";
  import { formatAppError } from "@/errors";
  import Alert from "@/ui/Alert.svelte";
  import AsyncState from "@/ui/AsyncState.svelte";
  import Dialog from "@/ui/Dialog.svelte";
  import Icon from "@/ui/Icon.svelte";
  import type { ResolutionPreset } from "./api";
  import { presetLibrary } from "./store";

  let { onclose }: { onclose: () => void } = $props();
  let form: HTMLFormElement;
  let mounted = false;
  let drafts = $state<(ResolutionPreset & { id: string })[]>([]);
  let saved = $state<ResolutionPreset[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");
  let conflict = $state(false);
  let confirmReload = $state(false);
  let announcement = $state("");
  let draggingId = $state<string | null>(null);
  let dropTarget = $state<{ id: string; after: boolean } | null>(null);
  const presetName = ({ name, x, y }: ResolutionPreset): string => name.trim() || `${x}:${y}`;
  const entries = $derived(drafts.map((draft) => ({ name: presetName(draft), x: draft.x, y: draft.y })));
  const dirty = $derived(JSON.stringify(entries) !== JSON.stringify(saved));
  const duplicates = $derived(
    new Set(
      entries
        .filter((entry, index) => entries.findIndex((other) => other.name === entry.name) !== index)
        .map((entry) => entry.name),
    ),
  );

  onMount(() => {
    mounted = true;
    void load();
    return () => {
      mounted = false;
    };
  });

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
    } else onclose();
  }
  async function add() {
    drafts.push({ id: crypto.randomUUID(), name: "", x: 1, y: 1 });
    await tick();
    form.querySelector<HTMLInputElement>(`input[aria-label="Preset ${drafts.length} name"]`)?.focus();
  }
  async function move(index: number, target: number) {
    if (saving || index === target || target < 0 || target >= drafts.length) return;
    const focused = document.activeElement;
    const [preset] = drafts.splice(index, 1);
    if (!preset) return;
    drafts.splice(target, 0, preset);
    announcement = `${presetName(preset)} moved to position ${target + 1} of ${drafts.length}.`;
    await tick();
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
  }
  function swap(draft: ResolutionPreset) {
    if (draft.name.trim() === `${draft.x}:${draft.y}`) draft.name = `${draft.y}:${draft.x}`;
    [draft.x, draft.y] = [draft.y, draft.x];
  }
  function dragOver(event: DragEvent & { currentTarget: HTMLElement }, id: string) {
    if (!draggingId || saving) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    dropTarget = draggingId === id ? null : { id, after: event.clientY > bounds.top + bounds.height / 2 };
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

<Dialog label="Manage aspect-ratio presets" width={600} busy={saving} {onclose}>
  <form
    bind:this={form}
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
        <button type="button" class="quiet" disabled={saving} onclick={onclose}>Cancel</button>
        <button type="submit" class="primary" disabled={saving || loading || conflict || !drafts.length}
          >{saving ? "Saving…" : "Save presets"}</button
        >
      </div>
    </header>
    {#if (error && drafts.length) || conflict}
      <div class="feedback">
        {#if error && drafts.length}<Alert message={error} />{/if}
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
      <AsyncState
        loading={loading && !drafts.length}
        error={drafts.length ? "" : error}
        loadingText="Loading your presets…"
        retryText="Retry loading presets"
        onretry={() => void load(true)}
      >
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
              class="icon-button reveal"
              disabled={saving || draft.x === draft.y}
              aria-label={`Swap preset ${index + 1} orientation`}
              title="Swap orientation"
              onclick={() => swap(draft)}><Icon name="swap-vertical" size={15} /></button
            >
            <button
              type="button"
              class="icon-button reveal delete"
              disabled={saving || drafts.length === 1}
              aria-label={`Delete preset ${index + 1}`}
              title="Delete preset"
              onclick={() => drafts.splice(index, 1)}><Icon name="trash" size={15} /></button
            >
          </div>
        {/each}
      </AsyncState>
    </div>
    {#if drafts.length}
      <button type="button" class="add-preset with-icon" disabled={saving || loading} onclick={add}
        ><Icon name="plus" size={15} />Add preset</button
      >
    {/if}
    <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
  </form>
</Dialog>

<style>
  form {
    display: flex;
    flex-direction: column;
    min-height: 0;
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
  .feedback {
    padding: 10px 20px;
    font-size: 12px;
  }
  .feedback p {
    margin: 0 0 8px;
    color: var(--muted);
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
  .drag-handle {
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
  .reveal {
    opacity: 0;
  }
  .preset-draft:is(:hover, :focus-within) .reveal {
    opacity: 1;
  }
  .preset-draft:is(:hover, :focus-within) .reveal:disabled {
    opacity: 0.38;
  }
  .delete:hover {
    color: var(--danger);
  }
  .add-preset {
    gap: 8px;
    flex-shrink: 0;
    margin: 6px 18px 16px;
    padding: 8px 12px;
    border-style: dashed;
    background: transparent;
    color: var(--muted);
  }
  .add-preset:hover {
    background: var(--accent-bg);
    color: var(--accent);
  }
  @media (hover: none) {
    .reveal {
      opacity: 1;
    }
    .reveal:disabled {
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
    .add-preset {
      margin: 6px 10px 12px;
    }
  }
</style>
