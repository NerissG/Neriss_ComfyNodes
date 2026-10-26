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
  let loading = true;
  let saving = false;
  let error = "";
  let conflict = false;
  let confirmReload = false;
  let announcement = "";
  let draggingId: string | null = null;
  let dropTarget: { id: string; after: boolean } | null = null;
  async function load(retry = false) {
    loading = true;
    error = "";
    const result = await (retry ? presetLibrary.reload() : presetLibrary.ensureLoaded());
    if (!mounted) return;
    loading = false;
    if (result.isErr()) error = formatAppError(result.error);
    else {
      drafts = result.value.map((preset) => ({ ...preset, id: crypto.randomUUID() }));
      conflict = false;
      confirmReload = false;
    }
  }
  async function save() {
    if (saving || loading || conflict || !drafts.length) return;
    saving = true;
    error = "";
    const result = await presetLibrary.save(drafts.map(({ name, x, y }) => ({ name: name.trim(), x, y })));
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
    announcement = `${preset.name || "Untitled preset"} moved to position ${target + 1} of ${drafts.length}.`;
    await tick();
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
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
        <p>Shared with Resolution Selector. Drag to reorder, or use the arrow buttons.</p>
      </div>
      <button type="button" class="quiet" aria-label="Close preset manager" disabled={saving} onclick={oncancel}
        >×</button
      >
    </header>
    <div class="preset-rows" role="group" aria-label="Presets" aria-disabled={saving} aria-busy={loading}>
      {#if loading}
        <p role="status">Loading your presets…</p>
      {:else if !drafts.length}
        <p class="field-error" role="alert">{error}</p>
        <button type="button" onclick={() => void load(true)}>Retry loading presets</button>
      {:else}
        <div class="column-labels" aria-hidden="true">
          <span></span><span>Name</span><span>Width</span><span>Height</span><span>Order / remove</span>
        </div>
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
            <label
              ><span class="mobile-label">Name</span><input
                aria-label={`Preset ${index + 1} name`}
                bind:value={draft.name}
                placeholder="Preset name"
                required
                disabled={saving}
              /></label
            >
            <label
              ><span class="mobile-label">Width</span><input
                type="number"
                aria-label={`Preset ${index + 1} width`}
                bind:value={draft.x}
                min="1"
                max="100000"
                step="1"
                required
                disabled={saving}
              /></label
            >
            <label
              ><span class="mobile-label">Height</span><input
                type="number"
                aria-label={`Preset ${index + 1} height`}
                bind:value={draft.y}
                min="1"
                max="100000"
                step="1"
                required
                disabled={saving}
              /></label
            >
            <div class="row-actions">
              <button
                type="button"
                class="quiet"
                disabled={saving || index === 0}
                aria-label={`Move preset ${index + 1} up`}
                onclick={() => move(index, index - 1)}>↑</button
              >
              <button
                type="button"
                class="quiet"
                disabled={saving || index === drafts.length - 1}
                aria-label={`Move preset ${index + 1} down`}
                onclick={() => move(index, index + 1)}>↓</button
              >
              <button
                type="button"
                class="quiet danger"
                disabled={saving || drafts.length === 1}
                aria-label={`Delete preset ${index + 1}`}
                onclick={() => (drafts = drafts.filter((_, position) => position !== index))}>×</button
              >
            </div>
          </div>
        {/each}
      {/if}
    </div>
    <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
    <footer>
      {#if error && drafts.length}<p class="field-error" role="alert">{error}</p>{/if}
      {#if conflict}
        <div class="conflict-recovery">
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
        </div>
      {/if}
      <div class="actions">
        <button type="button" disabled={saving || loading || !drafts.length} onclick={add}>Add preset</button>
        <div class="button-row">
          <button type="button" class="quiet" disabled={saving} onclick={oncancel}>Cancel</button>
          <button type="submit" class="save-presets" disabled={saving || loading || conflict || !drafts.length}
            >{saving ? "Saving…" : "Save presets"}</button
          >
        </div>
      </div>
    </footer>
  </form>
</dialog>

<style>
  .preset-modal {
    pointer-events: auto;
    width: min(760px, calc(100vw - 32px));
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
  footer {
    flex-shrink: 0;
    padding: 16px 20px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 16px;
    border-bottom: 1px solid var(--border);
  }
  header h2 {
    font-size: 16px;
    margin: 0;
  }
  header p {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  header button {
    font-size: 20px;
    line-height: 1;
  }
  .preset-rows {
    border: 0;
    margin: 0;
    padding: 12px 20px;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .column-labels,
  .preset-draft {
    display: grid;
    grid-template-columns: 28px minmax(100px, 1fr) 88px 88px 108px;
    gap: 10px;
    align-items: center;
  }
  .column-labels {
    padding-bottom: 8px;
    color: var(--muted);
    font-size: 12px;
  }
  .preset-draft {
    position: relative;
    padding: 5px 0;
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
    padding: 6px 2px;
    font-size: 20px;
    color: var(--muted);
  }
  .drag-handle:active {
    cursor: grabbing;
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
  .preset-draft label {
    margin: 0;
    min-width: 0;
  }
  .mobile-label {
    display: none;
  }
  .row-actions {
    display: flex;
    gap: 3px;
  }
  .row-actions button {
    width: 34px;
    padding: 6px;
  }
  footer {
    border-top: 1px solid var(--border);
  }
  .conflict-recovery {
    margin-bottom: 12px;
  }
  .conflict-recovery p {
    margin: 0 0 8px;
    color: var(--muted);
  }
  .conflict-recovery .button-row {
    flex-wrap: wrap;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .preset-modal .save-presets {
    background: var(--accent-bg);
    border-color: var(--accent-line);
    color: var(--accent);
  }
  @media (max-width: 560px) {
    header,
    footer {
      padding: 12px;
    }
    .preset-rows {
      padding: 8px 12px;
    }
    .column-labels {
      display: none;
    }
    .preset-draft {
      grid-template-columns: 24px minmax(60px, 1fr) 56px 56px;
      gap: 6px;
      border-bottom: 1px solid var(--border);
      padding: 10px 0;
    }
    .mobile-label {
      display: block;
    }
    .row-actions {
      grid-column: 1 / -1;
      justify-content: end;
    }
  }
</style>
