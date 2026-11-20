<script lang="ts">
  import { onMount, tick } from "svelte";
  import { on } from "svelte/events";
  import { err, ok } from "neverthrow";
  import { editorErrors, formatAppError, type AppError } from "@/errors";
  import { readClipboardText, writeClipboardText } from "@/shared/clipboard";
  import { parseBoundedJson } from "@/shared/json";
  import Alert from "@/ui/Alert.svelte";
  import AsyncState from "@/ui/AsyncState.svelte";
  import Icon from "@/ui/Icon.svelte";
  import SearchInput from "@/ui/SearchInput.svelte";
  import ToggleGroup from "@/ui/ToggleGroup.svelte";
  import { layoutPresetPayloadSchema } from "./api";
  import { MAX_PRESETS } from "./limits";
  import { presetOptions, presetPartOptions, presetSummary, type PresetPartOption } from "./models";
  import {
    applyPreset,
    capturePreset,
    type ApplyMode,
    type EditorModel,
    type EditorState,
    type LayoutPreset,
    type PresetPart,
  } from "./state";
  import { layoutPresetLibrary } from "./store";

  type Props = {
    layout: EditorState;
    model: EditorModel;
    onchange: (state: EditorState) => void;
    onerror: (error: AppError) => void;
    onnotice: (message: string) => void;
  };
  type RowMode = "apply" | "actions" | "rename" | "update" | "delete";
  const applyModes: { id: ApplyMode; label: string; title: string }[] = [
    { id: "replace", label: "Replace", title: "Replace every region on the canvas" },
    { id: "append", label: "Append", title: "Add the preset's regions after the current ones" },
  ];
  let { layout, model, onchange, onerror, onnotice }: Props = $props();
  let mounted = false;
  let list = $state<HTMLDivElement>();
  let busy = $state(false);
  let name = $state("");
  let overwriteName = $state<string | null>(null);
  let saveSkipped = $state<PresetPart[]>([]);
  let query = $state("");
  let expanded = $state<{ id: string; mode: RowMode } | null>(null);
  let formSkipped = $state<PresetPart[]>([]);
  let applyMode = $state<ApplyMode>("replace");
  let renameValue = $state("");
  let announcement = $state("");
  let draggingId = $state<string | null>(null);
  let dropTarget = $state<{ id: string; after: boolean } | null>(null);
  const library = $derived($layoutPresetLibrary);
  const presets = $derived(library.presets);
  const options = $derived(presetPartOptions[model]);
  const saveParts = $derived(options.map(({ part }) => part).filter((part) => !saveSkipped.includes(part)));
  const ready = $derived(library.loaded && !busy);
  const visible = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? presets.filter((preset) =>
          `${preset.name} ${presetSummary(model, preset.parts)}`.toLowerCase().includes(needle),
        )
      : presets;
  });

  onMount(() => {
    mounted = true;
    void layoutPresetLibrary.ensureLoaded();
    return () => {
      mounted = false;
    };
  });

  function toggled(parts: PresetPart[], part: PresetPart): PresetPart[] {
    return parts.includes(part) ? parts.filter((item) => item !== part) : [...parts, part];
  }
  function labels(choices: PresetPartOption[]): string {
    return choices.map(({ label }) => label.toLowerCase()).join(", ");
  }
  async function commit(next: LayoutPreset[], message = ""): Promise<boolean> {
    if (!ready) return false;
    if (next.length > MAX_PRESETS) {
      onerror(editorErrors.runtime(`Preset libraries are limited to ${MAX_PRESETS} presets`));
      return false;
    }
    busy = true;
    const result = await layoutPresetLibrary.save(next);
    if (!mounted) return false;
    busy = false;
    if (result.isErr()) {
      onerror(result.error);
      return false;
    }
    if (message) onnotice(message);
    return true;
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !saveParts.length) return;
    const existing = presets.find((preset) => preset.name === trimmed);
    if (existing && overwriteName !== trimmed) {
      overwriteName = trimmed;
      return;
    }
    const preset = { id: existing?.id ?? crypto.randomUUID(), name: trimmed, parts: capturePreset(layout, saveParts) };
    const next = existing ? presets.map((item) => (item.id === existing.id ? preset : item)) : [...presets, preset];
    if (await commit(next, `${existing ? "Replaced" : "Saved"} preset ${trimmed}.`)) {
      name = "";
      overwriteName = null;
    }
  }
  async function focusRow(id: string, selector: string) {
    await tick();
    list?.querySelector<HTMLElement>(`[data-preset="${CSS.escape(id)}"] ${selector}`)?.focus();
  }
  // Row forms replace the focused control, so move focus with them; it would otherwise fall back to the editor.
  function close() {
    const id = expanded?.id;
    expanded = null;
    if (id) void focusRow(id, ".preset-head button[aria-expanded]:not(:disabled)");
  }
  function expand(preset: LayoutPreset, mode: RowMode) {
    if (expanded?.id === preset.id && expanded.mode === mode) {
      close();
      return;
    }
    expanded = { id: preset.id, mode };
    // Updating starts from the parts the preset already holds; applying starts from all of them.
    formSkipped =
      mode === "update" ? options.filter(({ part }) => preset.parts[part] === undefined).map(({ part }) => part) : [];
    renameValue = preset.name;
    void focusRow(preset.id, ".preset-form :is(input, button)");
  }
  function apply(preset: LayoutPreset) {
    const chosen = presetOptions(model, preset.parts).filter(({ part }) => !formSkipped.includes(part));
    const result = applyPreset(
      layout,
      preset.parts,
      chosen.map(({ part }) => part),
      applyMode,
    );
    if (result.isErr()) {
      onerror(result.error);
      return;
    }
    onchange(result.value);
    close();
    onnotice(`Applied ${labels(chosen)} from ${preset.name}. Use Undo to restore.`);
  }
  async function update(preset: LayoutPreset) {
    const chosen = options.filter(({ part }) => !formSkipped.includes(part));
    const parts = {
      ...preset.parts,
      ...capturePreset(
        layout,
        chosen.map(({ part }) => part),
      ),
    };
    const next = presets.map((item) => (item.id === preset.id ? { ...preset, parts } : item));
    if (await commit(next, `Updated ${labels(chosen)} in ${preset.name}.`)) close();
  }
  async function rename(preset: LayoutPreset) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === preset.name) {
      close();
      return;
    }
    if (presets.some((item) => item.name === trimmed)) {
      onerror(editorErrors.runtime(`A preset named ${trimmed} already exists`));
      return;
    }
    const next = presets.map((item) => (item.id === preset.id ? { ...preset, name: trimmed } : item));
    if (await commit(next, `Renamed ${preset.name} to ${trimmed}.`)) close();
  }
  async function remove(preset: LayoutPreset) {
    if (
      await commit(
        presets.filter((item) => item.id !== preset.id),
        `Deleted preset ${preset.name}.`,
      )
    )
      expanded = null;
  }
  async function copy(items: LayoutPreset[], message: string) {
    const result = await writeClipboardText(JSON.stringify({ presets: items }, null, 2));
    if (!mounted) return;
    if (result.isErr()) onerror(result.error);
    else onnotice(message);
  }
  async function paste() {
    const result = await readClipboardText()
      .andThen(parseBoundedJson)
      .andThen((value) => {
        const parsed = layoutPresetPayloadSchema.safeParse(value);
        return parsed.success
          ? ok(parsed.data.presets)
          : err(editorErrors.runtime("Clipboard does not contain layout presets", { issues: parsed.error.issues }));
      });
    if (!mounted) return;
    if (result.isErr()) {
      onerror(result.error);
      return;
    }
    const names = presets.map((preset) => preset.name);
    const pasted = result.value.map((preset) => {
      let unique = preset.name;
      for (let suffix = 2; names.includes(unique); suffix += 1) unique = `${preset.name} (${suffix})`;
      names.push(unique);
      return { ...preset, id: crypto.randomUUID(), name: unique };
    });
    await commit([...presets, ...pasted], `Pasted ${pasted.length} ${pasted.length === 1 ? "preset" : "presets"}.`);
  }
  async function move(index: number, target: number) {
    if (index === target || target < 0 || target >= presets.length) return;
    const next = [...presets];
    const [preset] = next.splice(index, 1);
    if (!preset) return;
    next.splice(target, 0, preset);
    if (await commit(next)) announcement = `${preset.name} moved to position ${target + 1} of ${next.length}.`;
  }
  function dragOver(event: DragEvent & { currentTarget: HTMLElement }, id: string) {
    if (!draggingId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    dropTarget = draggingId === id ? null : { id, after: event.clientY > bounds.top + bounds.height / 2 };
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    if (draggingId && dropTarget) {
      const index = presets.findIndex((preset) => preset.id === draggingId);
      const slot = presets.findIndex((preset) => preset.id === dropTarget?.id) + (dropTarget.after ? 1 : 0);
      if (index >= 0) void move(index, slot - (index < slot ? 1 : 0));
    }
    draggingId = null;
    dropTarget = null;
  }
  function collapse(event: KeyboardEvent) {
    if (event.key !== "Escape" || !expanded) return;
    // A prevented Escape is ignored by the editor, which would otherwise clear the selection or close.
    event.preventDefault();
    close();
  }
</script>

{#snippet partPicker(
  legend: string,
  choices: PresetPartOption[],
  skipped: PresetPart[],
  onpick: (skipped: PresetPart[]) => void,
)}
  <fieldset class="preset-parts">
    <legend>{legend}</legend>
    {#each choices as option (option.part)}
      <label class="check-label"
        ><input
          type="checkbox"
          checked={!skipped.includes(option.part)}
          onchange={() => onpick(toggled(skipped, option.part))}
        />{option.label}</label
      >
    {/each}
  </fieldset>
{/snippet}

<section>
  <h2>Save preset</h2>
  <form onsubmit={save}>
    <label
      >Name <input
        bind:value={name}
        placeholder="Preset name"
        oninput={() => (overwriteName = null)}
        disabled={!library.loaded}
      /></label
    >
    {@render partPicker("Parts to save", options, saveSkipped, (skipped) => (saveSkipped = skipped))}
    {#if overwriteName}
      <p class="subtle" role="status">Replace the saved preset “{overwriteName}”?</p>
      <div class="button-row">
        <button type="button" class="quiet" onclick={() => (overwriteName = null)}>Cancel</button>
        <button type="submit" class="primary" disabled={!ready}>Replace preset</button>
      </div>
    {:else}
      <button type="submit" class="primary" disabled={!ready || !name.trim() || !saveParts.length}>Save preset</button>
    {/if}
  </form>
</section>
<section>
  <div class="section-heading">
    <h2>Presets<span class="count">{presets.length}</span></h2>
    <div class="button-row">
      <button
        type="button"
        class="icon-button"
        aria-label="Copy all presets"
        title="Copy all presets as JSON"
        disabled={!presets.length}
        onclick={() => copy(presets, "Copied all presets.")}><Icon name="copy" size={15} /></button
      >
      <button
        type="button"
        class="icon-button"
        aria-label="Paste presets"
        title="Add presets from JSON in the clipboard"
        disabled={!ready}
        onclick={paste}><Icon name="paste" size={15} /></button
      >
    </div>
  </div>
  {#if library.error && library.presets.length}<Alert
      message={formatAppError(library.error)}
      action={{
        label: "Reload latest presets",
        disabled: library.loading,
        onclick: () => void layoutPresetLibrary.reload(),
      }}
    />{/if}
  <AsyncState
    loading={library.loading && !presets.length}
    error={library.error && !presets.length ? formatAppError(library.error) : ""}
    loadingText="Loading presets…"
    retryText="Retry loading presets"
    onretry={() => void layoutPresetLibrary.reload()}
  >
    {#if !presets.length}<p class="empty-state">No presets yet.</p>
    {:else}
      <SearchInput class="preset-search" label="Search presets" placeholder="Search presets…" bind:value={query} />
      {#if !visible.length}<p class="empty-state">No presets match “{query}”.</p>{/if}
      <div class="preset-items" bind:this={list} {@attach (element) => on(element, "keydown", collapse)}>
        {#each visible as preset (preset.id)}
          {@const usable = presetOptions(model, preset.parts)}
          {@const open = expanded?.id === preset.id ? expanded.mode : null}
          <div
            class="preset-item"
            class:unusable={!usable.length}
            class:dragging={draggingId === preset.id}
            class:drop-before={dropTarget?.id === preset.id && !dropTarget.after}
            class:drop-after={dropTarget?.id === preset.id && dropTarget.after}
            role="group"
            aria-label={preset.name}
            data-preset={preset.id}
            ondragover={(event) => dragOver(event, preset.id)}
            ondrop={drop}
          >
            <div class="preset-head">
              {#if !query}<button
                  type="button"
                  class="quiet preset-handle"
                  draggable="true"
                  aria-label={`Reorder ${preset.name}`}
                  title="Drag to reorder; use ↑ or ↓ when focused"
                  ondragstart={(event) => {
                    draggingId = preset.id;
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", preset.id);
                    }
                  }}
                  ondragend={() => {
                    draggingId = null;
                    dropTarget = null;
                  }}
                  onkeydown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    event.preventDefault();
                    const index = presets.indexOf(preset);
                    void move(index, index + (event.key === "ArrowUp" ? -1 : 1));
                  }}>⠿</button
                >{/if}
              <div class="preset-name">
                <strong>{preset.name}</strong>
                <small>{presetSummary(model, preset.parts)}</small>
              </div>
              <button
                type="button"
                aria-expanded={open === "apply"}
                disabled={!usable.length}
                title={usable.length ? undefined : "This preset has no parts for this editor"}
                onclick={() => expand(preset, "apply")}>Apply…</button
              >
              <button
                type="button"
                class="icon-button"
                aria-label={`More actions for ${preset.name}`}
                aria-expanded={open === "actions"}
                onclick={() => expand(preset, "actions")}><Icon name="more" size={15} /></button
              >
            </div>
            {#if open === "apply"}
              <form
                class="preset-form"
                onsubmit={(event) => {
                  event.preventDefault();
                  apply(preset);
                }}
              >
                {@render partPicker("Parts to apply", usable, formSkipped, (skipped) => (formSkipped = skipped))}
                {#if preset.parts.elements && !formSkipped.includes("elements")}
                  <ToggleGroup
                    label={`Existing ${usable[0]?.label.toLowerCase()}`}
                    items={applyModes}
                    value={applyMode}
                    onselect={(mode) => (applyMode = mode)}
                  />
                {/if}
                <div class="button-row">
                  <button type="button" class="quiet" onclick={close}>Cancel</button>
                  <button
                    type="submit"
                    class="primary"
                    disabled={usable.every(({ part }) => formSkipped.includes(part))}>Apply</button
                  >
                </div>
              </form>
            {:else if open === "actions"}
              <div class="preset-form button-row wrap">
                <button type="button" class="with-icon" onclick={() => expand(preset, "rename")}
                  ><Icon name="pencil" size={14} />Rename</button
                >
                <button type="button" class="with-icon" onclick={() => expand(preset, "update")}
                  ><Icon name="reset" size={14} />Update…</button
                >
                <button type="button" class="with-icon" onclick={() => copy([preset], `Copied preset ${preset.name}.`)}
                  ><Icon name="copy" size={14} />Copy JSON</button
                >
                <button type="button" class="with-icon danger" onclick={() => expand(preset, "delete")}
                  ><Icon name="trash" size={14} />Delete…</button
                >
              </div>
            {:else if open === "rename"}
              <form
                class="preset-form"
                onsubmit={(event) => {
                  event.preventDefault();
                  void rename(preset);
                }}
              >
                <label>New name <input bind:value={renameValue} /></label>
                <div class="button-row">
                  <button type="button" class="quiet" onclick={close}>Cancel</button>
                  <button type="submit" class="primary" disabled={!ready || !renameValue.trim()}>Rename</button>
                </div>
              </form>
            {:else if open === "update"}
              <form
                class="preset-form"
                onsubmit={(event) => {
                  event.preventDefault();
                  void update(preset);
                }}
              >
                {@render partPicker(
                  "Replace with the current editor values",
                  options,
                  formSkipped,
                  (skipped) => (formSkipped = skipped),
                )}
                <div class="button-row">
                  <button type="button" class="quiet" onclick={close}>Cancel</button>
                  <button
                    type="submit"
                    class="primary"
                    disabled={!ready || options.every(({ part }) => formSkipped.includes(part))}>Update preset</button
                  >
                </div>
              </form>
            {:else if open === "delete"}
              <div class="preset-form">
                <p class="subtle">Delete “{preset.name}”? This cannot be undone.</p>
                <div class="button-row">
                  <button type="button" class="quiet" onclick={close}>Cancel</button>
                  <button type="button" class="danger" disabled={!ready} onclick={() => remove(preset)}
                    >Delete preset</button
                  >
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </AsyncState>
  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
</section>

<style>
  .preset-parts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    min-width: 0;
    margin: 0 0 12px;
    padding: 0;
    border: 0;
  }
  .preset-parts legend {
    width: 100%;
    margin-bottom: 6px;
    padding: 0;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 500;
  }
  .preset-parts :global(.check-label) {
    font-size: 12px;
  }
  :global(.preset-search) {
    margin-bottom: 8px;
  }
  .preset-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .preset-item {
    position: relative;
    border-radius: 6px;
  }
  .preset-item:is(:hover, :focus-within) {
    background: var(--surface-2);
  }
  .preset-item.dragging {
    opacity: 0.45;
  }
  .preset-item.unusable .preset-name {
    opacity: 0.55;
  }
  .preset-item.drop-before::before,
  .preset-item.drop-after::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
    pointer-events: none;
  }
  .preset-item.drop-before::before {
    top: -1px;
  }
  .preset-item.drop-after::after {
    bottom: -1px;
  }
  .preset-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 4px 2px;
  }
  .preset-handle {
    padding: 2px 4px;
    color: var(--placeholder);
    cursor: grab;
  }
  .preset-name {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .preset-name :is(strong, small) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preset-name strong {
    font-size: 13px;
    font-weight: 500;
  }
  .preset-name small {
    color: var(--muted);
    font-size: 11px;
  }
  .preset-form {
    display: grid;
    gap: 10px;
    padding: 6px 8px 10px 28px;
  }
  .preset-form .subtle {
    margin: 0;
  }
  .preset-form label {
    margin: 0;
  }
  .preset-form .button-row {
    justify-content: flex-end;
  }
  .preset-form.button-row {
    justify-content: flex-start;
    margin: 0;
  }
</style>
