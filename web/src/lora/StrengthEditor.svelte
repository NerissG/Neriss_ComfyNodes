<script lang="ts">
  import { onMount, tick } from "svelte";
  import { on } from "svelte/events";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import type { ComfyNode } from "@/comfy/types";
  import { readWidgetValue, writeWidgetValue } from "@/editor/services";
  import { formatAppError } from "@/errors";
  import {
    emptyStrengthState,
    parseStrengthState,
    strengthSchema,
    targetGroups,
    targetMultiplier,
    type LoraManifest,
    type StrengthState,
  } from "./state";
  import {
    blockChanged,
    buildBlockFamilies,
    filterBlockFamilies,
    resetBlockMultipliers,
    setBlockMultipliers,
    type StrengthBlock,
  } from "./blocks";
  import { loadLoraTargets, loraChoices } from "./services";
  import StrengthControl from "./StrengthControl.svelte";
  import LoraPicker from "./LoraPicker.svelte";

  export let node: ComfyNode;
  export let oncancel: () => void;
  let dialog: HTMLDialogElement;
  const selection = readWidgetValue(node, "lora_name");
  let loraName = typeof selection === "string" ? selection : "";
  const choices = loraChoices(node);
  const drafts = new SvelteMap<string, { state: StrengthState; error: string }>();
  const parsed = parseStrengthState(readWidgetValue(node, "state_json"));
  let state = parsed.isOk() ? parsed.value : emptyStrengthState(loraName);
  let stateError = parsed.isErr()
    ? `${formatAppError(parsed.error)}. Reset explicitly to replace the saved state.`
    : "";
  let modelStrength = strengthSchema.catch(1).parse(readWidgetValue(node, "strength_model"));
  let clipStrength = strengthSchema.catch(1).parse(readWidgetValue(node, "strength_clip"));
  let manifest: LoraManifest | null = null;
  let loading = true;
  let error = "";
  let query = "";
  let changedOnly = false;
  let activeFamily: string | null = null;
  let selected = new SvelteSet<string>();
  let inspecting: string | null = null;
  let moduleQuery = "";
  let bulkValue = 1;
  let mounted = false;
  let loadGeneration = 0;
  $: mismatch = Object.keys(state.overrides).length > 0 && state.lora_name !== loraName;
  $: disabled = mismatch || Boolean(stateError);
  $: families = buildBlockFamilies(manifest?.targets ?? []);
  $: allBlocks = families.flatMap((family) => family.blocks);
  $: filtered = filterBlockFamilies(families, query, changedOnly, state.overrides);
  $: visibleFamilies = activeFamily === null ? filtered : filtered.filter((family) => family.name === activeFamily);
  $: visibleBlocks = visibleFamilies.flatMap((family) => family.blocks);
  $: allSelected = visibleBlocks.length > 0 && visibleBlocks.every((block) => selected.has(block.name));
  $: inspected = allBlocks.find((block) => block.name === inspecting);
  $: modules =
    inspected?.controls.filter((control) =>
      `${control.name} ${control.label}`.toLowerCase().includes(moduleQuery.trim().toLowerCase()),
    ) ?? [];
  $: validNames = new Set((manifest?.targets ?? []).flatMap((name) => [...targetGroups(name), name]));
  $: unused = Object.keys(state.overrides).filter((name) => !validNames.has(name));

  onMount(() => {
    mounted = true;
    const opener = document.activeElement;
    dialog.showModal();
    void load();
    const cleanup = ["keydown", "keyup", "keypress", "paste", "copy", "cut"].map((type) =>
      on(dialog, type, (event) => event.stopPropagation()),
    );
    return () => {
      mounted = false;
      cleanup.forEach((remove) => remove());
      dialog.close();
      void tick().then(() => {
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
      });
    };
  });
  async function load() {
    const name = loraName;
    const generation = ++loadGeneration;
    loading = true;
    manifest = null;
    error = "";
    const result = await loadLoraTargets(name);
    if (!mounted || generation !== loadGeneration) return;
    loading = false;
    if (result.isErr()) error = formatAppError(result.error);
    else manifest = result.value;
  }
  function selectLora(name: string) {
    if (name === loraName || !choices.includes(name)) return;
    drafts.set(loraName, { state, error: stateError });
    loraName = name;
    const draft = drafts.get(name);
    state = draft?.state ?? emptyStrengthState(name);
    stateError = draft?.error ?? "";
    query = "";
    changedOnly = false;
    activeFamily = null;
    selected = new SvelteSet();
    inspecting = null;
    moduleQuery = "";
    void load();
  }
  function change(name: string, value: number | null) {
    const overrides = { ...state.overrides };
    if (value === null) delete overrides[name];
    else overrides[name] = value;
    state = { version: 1, lora_name: loraName, overrides };
  }
  function reset() {
    state = emptyStrengthState(loraName);
    stateError = "";
  }
  function select(name: string, checked: boolean) {
    const next = new SvelteSet(selected);
    if (checked) next.add(name);
    else next.delete(name);
    selected = next;
  }
  function selectVisible() {
    const next = new SvelteSet(selected);
    for (const block of visibleBlocks) {
      if (allSelected) next.delete(block.name);
      else next.add(block.name);
    }
    selected = next;
  }
  function inspect(block: StrengthBlock) {
    inspecting = inspecting === block.name ? null : block.name;
    moduleQuery = "";
  }
  function applyBulk() {
    if (disabled || !selected.size || !strengthSchema.safeParse(bulkValue).success) return;
    state = { version: 1, lora_name: loraName, overrides: setBlockMultipliers(state.overrides, selected, bulkValue) };
  }
  function resetSelected() {
    state = {
      ...state,
      overrides: resetBlockMultipliers(
        state.overrides,
        allBlocks.filter((block) => selected.has(block.name)),
      ),
    };
  }
  function save() {
    if (
      !manifest ||
      disabled ||
      !strengthSchema.safeParse(modelStrength).success ||
      !strengthSchema.safeParse(clipStrength).success
    )
      return;
    if (readWidgetValue(node, "lora_name") !== selection) {
      error = "LoRA selection changed. Cancel and reopen the editor.";
      return;
    }
    writeWidgetValue(node, "state_json", JSON.stringify({ ...state, lora_name: loraName }));
    writeWidgetValue(node, "strength_model", modelStrength);
    writeWidgetValue(node, "strength_clip", clipStrength);
    writeWidgetValue(node, "lora_name", loraName);
    node.widgets?.find((widget) => widget.name === "lora_name")?.callback?.(loraName);
    oncancel();
  }
</script>

<dialog
  bind:this={dialog}
  class="lora-modal neriss-editor-theme"
  aria-label="LoRA block strength editor"
  oncancel={(event) => {
    event.preventDefault();
    oncancel();
  }}
>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      save();
    }}
  >
    <header>
      <LoraPicker {choices} value={loraName} onchange={selectLora} />
      <div class="actions">
        <button type="button" class="quiet" onclick={oncancel}>Cancel</button><button
          type="submit"
          class="apply"
          disabled={loading || !manifest || disabled}>Apply strengths</button
        >
      </div>
    </header>
    <div class="toolbar">
      <input
        class="search"
        aria-label="Search LoRA targets"
        placeholder="Find block or module…"
        bind:value={query}
        oninput={() => (activeFamily = null)}
      />
      <div class="global">
        <span>Model</span><StrengthControl
          label="MODEL strength"
          value={modelStrength}
          onchange={(value) => (modelStrength = value)}
        />
      </div>
      <div class="global">
        <span>Clip</span><StrengthControl
          label="CLIP strength"
          value={clipStrength}
          onchange={(value) => (clipStrength = value)}
        />
      </div>
    </div>
    <div class="navigation">
      <div class="families" role="group" aria-label="Block families">
        <button type="button" aria-pressed={activeFamily === null} onclick={() => (activeFamily = null)}
          >All <small>{allBlocks.length}</small></button
        >
        {#each families as family (family.name)}
          <button
            type="button"
            title={family.name || "Unnumbered targets"}
            aria-pressed={activeFamily === family.name}
            onclick={() => (activeFamily = family.name)}>{family.label} <small>{family.blocks.length}</small></button
          >
        {/each}
      </div>
      <button
        type="button"
        class="changed-filter"
        aria-pressed={changedOnly}
        onclick={() => (changedOnly = !changedOnly)}>Changed</button
      >
    </div>
    {#if stateError || mismatch || error || manifest?.unsupported.length || (unused.length && !mismatch)}
      <div class="issues">
        {#if stateError}<p class="field-error" role="alert">
            {stateError} <button type="button" onclick={reset}>Reset overrides</button>
          </p>{/if}
        {#if mismatch}<p class="field-error" role="alert">
            Overrides belong to {state.lora_name}. <button type="button" onclick={reset}>Reset overrides</button>
          </p>{/if}
        {#if error}<p class="field-error" role="alert">
            {error} <button type="button" onclick={() => void load()}>Retry inspection</button>
          </p>{/if}
        {#if manifest?.unsupported.length}<details>
            <summary>{manifest.unsupported.length} unrecognized / special keys</summary>
            <pre>{manifest.unsupported.join("\n")}</pre>
          </details>{/if}
        {#if unused.length && !mismatch}<details>
            <summary>{unused.length} unmatched overrides</summary>
            <pre>{unused.join("\n")}</pre>
            <button
              type="button"
              onclick={() => {
                state = {
                  ...state,
                  overrides: Object.fromEntries(
                    Object.entries(state.overrides).filter(([name]) => validNames.has(name)),
                  ),
                };
              }}>Remove unmatched overrides</button
            >
          </details>{/if}
      </div>
    {/if}
    <div class="workspace" class:inspecting={Boolean(inspected)}>
      <div class="block-browser" aria-busy={loading}>
        {#if loading}<p class="empty" role="status">Loading…</p>
        {:else if manifest && !allBlocks.length}<p class="empty">No recognized targets.</p>
        {:else if manifest && !visibleBlocks.length}<p class="empty">No matching blocks.</p>
        {:else}
          {#each visibleFamilies as family (family.name)}
            <section class="family-section" aria-label={family.label}>
              {#if activeFamily === null && visibleFamilies.length > 1}<h3>{family.label}</h3>{/if}
              <div class="cards">
                {#each family.blocks as block (block.name)}
                  <div
                    class="block card"
                    class:changed={blockChanged(block, state.overrides)}
                    class:selected={selected.has(block.name)}
                    class:active={inspecting === block.name}
                  >
                    <input
                      class="selection"
                      type="checkbox"
                      aria-label={`Select ${block.name}`}
                      checked={selected.has(block.name)}
                      {disabled}
                      onchange={(event) => select(block.name, event.currentTarget.checked)}
                    />
                    <button
                      type="button"
                      class="block-name"
                      title={block.name}
                      aria-label={`Modules ${block.name}`}
                      aria-expanded={inspecting === block.name}
                      disabled={!block.controls.length}
                      onclick={() => inspect(block)}
                      ><span class="chevron">{inspecting === block.name ? "▾" : "▸"}</span>{block.label}</button
                    >
                    <div class="block-value">
                      <StrengthControl
                        label={`Multiplier ${block.name}`}
                        value={targetMultiplier(block.name, state.overrides)}
                        {disabled}
                        onchange={(value) => change(block.name, value)}
                      />
                    </div>
                    <input
                      class="card-slider"
                      type="range"
                      aria-label={`Slider Multiplier ${block.name}`}
                      min={Math.min(-2, targetMultiplier(block.name, state.overrides))}
                      max={Math.max(2, targetMultiplier(block.name, state.overrides))}
                      step="0.01"
                      value={targetMultiplier(block.name, state.overrides)}
                      {disabled}
                      oninput={(event) => change(block.name, event.currentTarget.valueAsNumber)}
                    />
                    <button
                      type="button"
                      class="inherit"
                      aria-label={`Inherit ${block.name}`}
                      title="Inherit parent multiplier"
                      disabled={disabled || !Object.hasOwn(state.overrides, block.name)}
                      onclick={() => change(block.name, null)}>↺</button
                    >
                  </div>
                {/each}
              </div>
            </section>
          {/each}
        {/if}
      </div>
      {#if inspected}
        <aside class="module-panel" aria-label={`Modules ${inspected.name}`}>
          <div class="module-header">
            <strong title={inspected.name}>{inspected.label}</strong><span>{inspected.targets.length}</span><button
              type="button"
              class="quiet"
              aria-label="Close module details"
              onclick={() => (inspecting = null)}>×</button
            >
          </div>
          <input
            class="module-search"
            aria-label="Search block modules"
            placeholder="Find module…"
            bind:value={moduleQuery}
          />
          <div class="module-list">
            {#each modules as control (control.name)}
              <div
                class="module-row"
                class:group={control.group}
                class:explicit={Object.hasOwn(state.overrides, control.name)}
              >
                <span class="module-name" title={control.name}>{control.label}</span>
                <StrengthControl
                  label={`Multiplier ${control.name}`}
                  value={targetMultiplier(control.name, state.overrides)}
                  {disabled}
                  onchange={(value) => change(control.name, value)}
                />
                <button
                  type="button"
                  class="inherit"
                  aria-label={`Inherit ${control.name}`}
                  title="Inherit parent multiplier"
                  disabled={disabled || !Object.hasOwn(state.overrides, control.name)}
                  onclick={() => change(control.name, null)}>↺</button
                >
              </div>
            {:else}<p class="empty">No matching modules.</p>{/each}
          </div>
        </aside>
      {/if}
    </div>
    <footer>
      <label class="select-visible"
        ><input
          type="checkbox"
          aria-label="Select visible blocks"
          checked={allSelected}
          disabled={disabled || !visibleBlocks.length}
          onchange={selectVisible}
        />{selected.size ? `${selected.size} selected` : `${visibleBlocks.length} blocks`}</label
      >
      {#if selected.size}<button type="button" class="quiet" onclick={() => (selected = new SvelteSet())}>Clear</button
        >{/if}
      {#if selected.size}<div class="bulk-actions">
          <StrengthControl
            label="Selected block multiplier"
            value={bulkValue}
            disabled={disabled || !selected.size}
            onchange={(value) => (bulkValue = value)}
          /><button
            type="button"
            title="Set block multipliers; module overrides stay unchanged"
            disabled={disabled || !selected.size}
            onclick={applyBulk}>Set selected</button
          ><button
            type="button"
            class="quiet"
            title="Remove block and module overrides in the selection"
            disabled={disabled || !selected.size}
            onclick={resetSelected}>Reset selected</button
          >
        </div>{/if}
      {#if !disabled}<button
          type="button"
          class="quiet reset-all"
          aria-label="Reset overrides"
          title="Reset all overrides"
          onclick={reset}>Reset all</button
        >{/if}
    </footer>
  </form>
</dialog>

<style>
  .lora-modal {
    width: min(1020px, calc(100vw - 28px));
    max-height: calc(100dvh - 28px);
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface-0);
    box-shadow: none;
    outline: none;
  }
  .lora-modal::backdrop {
    background: var(--backdrop);
  }
  form {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 30px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px 10px;
    flex-shrink: 0;
  }
  .actions {
    display: flex;
    gap: 5px;
    margin-left: auto;
    flex-shrink: 0;
  }
  .actions button {
    padding: 5px 9px;
  }
  button.apply {
    background: var(--accent-bg);
    border-color: var(--accent-line);
  }
  .toolbar {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 0 14px 8px;
    flex-shrink: 0;
  }
  .search {
    flex: 1;
    width: 80px;
    padding: 5px 8px;
    height: 29px;
    font-size: 12px;
  }
  .global {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--muted);
  }
  button[aria-pressed="true"] {
    color: var(--accent);
    background: var(--accent-bg);
  }
  .navigation {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .families {
    display: flex;
    gap: 3px;
    flex: 1;
    overflow-x: auto;
    min-width: 0;
  }
  .families button {
    background: transparent;
    border: 0;
    color: var(--muted);
    padding: 4px 7px;
    font-size: 11px;
  }
  .families button[aria-pressed="true"] {
    color: var(--accent);
    background: var(--accent-bg);
  }
  small {
    color: var(--muted);
    font-size: 10px;
    margin-left: 3px;
  }
  .changed-filter {
    font-size: 11px;
    padding: 3px 8px;
  }
  .issues {
    padding: 5px 14px;
    max-height: 130px;
    overflow: auto;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    flex-shrink: 0;
  }
  .issues p {
    margin: 3px 0;
  }
  .issues button {
    padding: 2px 6px;
    margin-left: 5px;
  }
  .issues details {
    padding: 3px 0;
    color: var(--muted);
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 11px;
  }
  .workspace {
    display: flex;
    min-height: 100px;
    min-width: 0;
    overflow: hidden;
  }
  .block-browser {
    min-width: 0;
    flex: 1;
    overflow: auto;
    max-height: min(540px, calc(100dvh - 185px));
    padding: 8px 12px;
    scrollbar-width: thin;
  }
  .family-section + .family-section {
    margin-top: 12px;
  }
  h3 {
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    margin: 0 2px 6px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 6px;
  }
  .block {
    min-width: 0;
    position: relative;
  }
  .block:hover {
    background: var(--surface-1);
  }
  .block.selected {
    background: var(--accent-bg);
  }
  .block.active {
    outline: 1px solid var(--accent-line);
    outline-offset: -1px;
  }
  .block-name {
    min-width: 0;
    border: 0;
    padding: 0;
    text-align: left;
    background: transparent;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .block-name:disabled {
    opacity: 1;
    color: var(--text);
    cursor: default;
  }
  .changed .block-name {
    color: var(--accent);
  }
  .chevron {
    display: inline-block;
    width: 16px;
    color: var(--muted);
  }
  .block-name:disabled .chevron {
    visibility: hidden;
  }
  input.selection,
  .select-visible input {
    width: 12px;
    height: 12px;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }
  button.inherit {
    width: 22px;
    height: 23px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font-size: 12px;
  }
  button.inherit:disabled {
    visibility: hidden;
  }
  .block-value {
    min-width: 0;
  }
  .card {
    display: grid;
    grid-template-columns: 13px minmax(0, 1fr) 17px;
    gap: 5px 3px;
    padding: 7px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface-1);
  }
  .card.changed {
    border-color: var(--accent-line);
  }
  .card .selection {
    grid-column: 1;
    grid-row: 1;
    align-self: center;
  }
  .card .block-name {
    grid-column: 2;
    grid-row: 1;
    font-size: 11px;
    line-height: 19px;
  }
  .card .chevron {
    float: right;
    width: auto;
  }
  .card .block-value {
    grid-column: 1 / -1;
    grid-row: 2;
    display: flex;
    justify-content: center;
  }
  .card .inherit {
    grid-column: 3;
    grid-row: 1;
    width: 17px;
  }
  input.card-slider {
    grid-column: 1 / -1;
    width: 100%;
    height: 10px;
    padding: 0;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .module-panel {
    width: 310px;
    flex-shrink: 0;
    min-width: 0;
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    max-height: min(540px, calc(100dvh - 185px));
    background: var(--surface-1);
  }
  .module-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 5px;
  }
  .module-header strong {
    font-size: 12px;
  }
  .module-header > span {
    color: var(--muted);
    font-size: 10px;
  }
  .module-header button {
    margin-left: auto;
    padding: 0;
    width: 22px;
    height: 22px;
    font-size: 17px;
  }
  .module-search {
    width: calc(100% - 20px);
    margin: 0 10px 6px;
    padding: 4px 6px;
    height: 26px;
    font-size: 11px;
  }
  .module-list {
    overflow: auto;
    padding: 0 6px 6px;
    scrollbar-width: thin;
  }
  .module-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 20px;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    padding: 3px 2px;
    border-bottom: 1px solid var(--surface-2);
  }
  .module-name {
    font:
      11px/1.3 ui-monospace,
      monospace;
    overflow-wrap: anywhere;
  }
  .module-row.group .module-name {
    font-weight: 600;
    color: var(--muted);
  }
  .module-row.explicit .module-name {
    color: var(--accent);
  }
  .empty {
    margin: 18px 4px;
    font-size: 12px;
    color: var(--muted);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    background: var(--surface-1);
    flex-shrink: 0;
  }
  .select-visible {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }
  footer button {
    font-size: 11px;
    padding: 4px 7px;
  }
  .bulk-actions {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
  }
  .reset-all {
    margin-left: auto;
  }
  @media (max-width: 720px) {
    header {
      gap: 8px;
      flex-wrap: wrap;
    }
    .toolbar {
      gap: 7px;
      flex-wrap: wrap;
    }
    .search {
      flex-basis: 100%;
    }
    .workspace.inspecting .block-browser {
      display: none;
    }
    .module-panel {
      width: 100%;
      border-left: 0;
    }
    footer {
      flex-wrap: wrap;
      gap: 5px;
      padding: 7px 10px;
    }
    .bulk-actions {
      order: 3;
      width: 100%;
      margin: 0;
    }
    .reset-all {
      margin-left: auto;
    }
    .block-browser,
    .module-panel {
      max-height: calc(100dvh - 265px);
    }
  }
  @media (max-width: 440px) {
    header,
    .toolbar,
    .navigation {
      padding-left: 10px;
      padding-right: 10px;
    }
    .cards {
      grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
      gap: 5px;
    }
    .block-browser {
      padding: 7px;
    }
    .global {
      gap: 4px;
    }
  }
</style>
