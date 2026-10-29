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
    clearOverrides,
    familyTargets,
    filterBlockFamilies,
    hasClipTargets,
    setBlockMultipliers,
  } from "./blocks";
  import { loadLoraTargets, loraChoices } from "./services";
  import StrengthControl from "./StrengthControl.svelte";
  import LoraPicker from "./LoraPicker.svelte";
  import FamilyChart from "./FamilyChart.svelte";

  export let node: ComfyNode;
  export let oncancel: () => void;
  type Draft = { state: StrengthState; error: string; past: StrengthState[]; future: StrengthState[] };
  let dialog: HTMLDialogElement;
  let search: HTMLInputElement;
  const selection = readWidgetValue(node, "lora_name");
  let loraName = typeof selection === "string" ? selection : "";
  const choices = loraChoices(node);
  const drafts = new SvelteMap<string, Draft>();
  const parsed = parseStrengthState(readWidgetValue(node, "state_json"));
  let state = parsed.isOk() ? parsed.value : emptyStrengthState(loraName);
  let stateError = parsed.isErr()
    ? `${formatAppError(parsed.error)}. Reset explicitly to replace the saved state.`
    : "";
  let past: StrengthState[] = [];
  let future: StrengthState[] = [];
  let historyGroup: string | null = null;
  let modelStrength = strengthSchema.catch(1).parse(readWidgetValue(node, "strength_model"));
  let clipStrength = strengthSchema.catch(1).parse(readWidgetValue(node, "strength_clip"));
  let manifest: LoraManifest | null = null;
  let loading = true;
  let error = "";
  let query = "";
  let changedOnly = false;
  let activeFamily: string | null = null;
  let lenses: Record<string, string> = {};
  let selected = new SvelteSet<string>();
  let anchor: string | null = null;
  let inspecting: string | null = null;
  let moduleQuery = "";
  let bulkValue = 1;
  let mounted = false;
  let loadGeneration = 0;
  $: mismatch = Object.keys(state.overrides).length > 0 && state.lora_name !== loraName;
  $: disabled = mismatch || Boolean(stateError);
  $: families = buildBlockFamilies(manifest?.targets ?? []);
  $: allBlocks = families.flatMap((family) => family.blocks);
  $: matching = new Set(
    filterBlockFamilies(families, query, changedOnly, state.overrides).flatMap((family) =>
      family.blocks.map((block) => block.name),
    ),
  );
  $: visibleFamilies = families.filter(
    (family) =>
      (activeFamily === null || family.name === activeFamily) &&
      family.blocks.some((block) => matching.has(block.name)),
  );
  $: charts = visibleFamilies.map((family) => ({ family, targets: familyTargets(family, lenses[family.name] ?? "") }));
  $: visibleTargets = charts.flatMap((chart) =>
    chart.targets.filter((target) => matching.has(target.block.name)).map((target) => target.name),
  );
  $: allSelected = visibleTargets.length > 0 && visibleTargets.every((name) => selected.has(name));
  $: changedCount = allBlocks.filter((block) => blockChanged(block, state.overrides)).length;
  $: overrideCount = Object.keys(state.overrides).length;
  $: showClip = hasClipTargets(manifest?.targets ?? []) || clipStrength !== 1;
  $: inspectedFamily = families.find((family) => family.blocks.some((block) => block.name === inspecting));
  $: inspected = inspectedFamily?.blocks.find((block) => block.name === inspecting);
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
    search.focus();
    void load();
    const cleanup = [
      on(dialog, "keydown", keydown),
      // The dialog is mounted on document.body, so keep the graph's document and window listeners from seeing editor input.
      ...[
        "keydown",
        "keyup",
        "keypress",
        "paste",
        "copy",
        "cut",
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
        "mousedown",
        "mousemove",
        "mouseup",
        "click",
        "dblclick",
        "auxclick",
        "contextmenu",
        "wheel",
      ].map((type) => on(dialog, type, (event) => event.stopPropagation())),
    ];
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
    drafts.set(loraName, { state, error: stateError, past, future });
    loraName = name;
    const draft = drafts.get(name);
    state = draft?.state ?? emptyStrengthState(name);
    stateError = draft?.error ?? "";
    past = draft?.past ?? [];
    future = draft?.future ?? [];
    historyGroup = null;
    query = "";
    changedOnly = false;
    activeFamily = null;
    lenses = {};
    selected = new SvelteSet();
    anchor = null;
    inspecting = null;
    moduleQuery = "";
    void load();
  }
  /** Records one undo step per call, or one per run of calls sharing a group such as a paint stroke. */
  function update(overrides: Record<string, number>, group: string | null = null) {
    if (group === null || group !== historyGroup) past = [...past.slice(-99), state];
    future = [];
    historyGroup = group;
    state = { version: 1, lora_name: loraName, overrides };
  }
  function undo() {
    const previous = past.at(-1);
    if (!previous) return;
    future = [state, ...future];
    past = past.slice(0, -1);
    state = previous;
    historyGroup = null;
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    past = [...past, state];
    future = future.slice(1);
    state = next;
    historyGroup = null;
  }
  function change(name: string, value: number | null) {
    const overrides = { ...state.overrides };
    if (value === null) delete overrides[name];
    else overrides[name] = value;
    update(overrides);
  }
  function reset() {
    update({});
    stateError = "";
  }
  function select(name: string, mode: "toggle" | "range") {
    const next = new SvelteSet(selected);
    const from = anchor === null ? -1 : visibleTargets.indexOf(anchor);
    const to = visibleTargets.indexOf(name);
    if (mode === "range" && from >= 0 && to >= 0) {
      for (const target of visibleTargets.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(target);
    } else if (next.has(name)) next.delete(name);
    else next.add(name);
    anchor = name;
    selected = next;
  }
  function selectVisible() {
    const next = new SvelteSet(selected);
    for (const name of visibleTargets) {
      if (allSelected) next.delete(name);
      else next.add(name);
    }
    selected = next;
  }
  function inspect(block: string) {
    if (inspecting !== block) moduleQuery = "";
    inspecting = block;
    const family = families.find((entry) => entry.blocks.some((item) => item.name === block));
    const lens = family ? (lenses[family.name] ?? "") : "";
    anchor = family ? (familyTargets(family, lens).find((target) => target.block.name === block)?.name ?? null) : null;
  }
  function setLens(family: string, lens: string) {
    lenses = { ...lenses, [family]: lens };
    selected = new SvelteSet();
    anchor = null;
  }
  function applyBulk() {
    if (disabled || !selected.size || !strengthSchema.safeParse(bulkValue).success) return;
    update(setBlockMultipliers(state.overrides, selected, bulkValue));
  }
  function resetSelected() {
    update(clearOverrides(state.overrides, selected));
  }
  function keydown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || disabled) return;
    if (event.target instanceof HTMLInputElement && event.target.type !== "checkbox") return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) undo();
    else if (key === "y" || (key === "z" && event.shiftKey)) redo();
    else return;
    event.preventDefault();
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
      <div class="global">
        <span>Model</span><StrengthControl
          label="MODEL strength"
          value={modelStrength}
          onchange={(value) => (modelStrength = value)}
        />
      </div>
      {#if showClip}<div class="global">
          <span>Clip</span><StrengthControl
            label="CLIP strength"
            value={clipStrength}
            onchange={(value) => (clipStrength = value)}
          />
        </div>{/if}
      <div class="actions">
        {#if overrideCount}<span class="dirty" role="status"
            >{overrideCount} override{overrideCount === 1 ? "" : "s"}</span
          >{/if}
        <button type="button" class="quiet" onclick={oncancel}>Cancel</button><button
          type="submit"
          class="apply"
          disabled={loading || !manifest || disabled}>Apply strengths</button
        >
      </div>
    </header>
    <div class="toolbar">
      <input
        bind:this={search}
        class="search"
        aria-label="Search LoRA targets"
        placeholder="Find block or module…"
        bind:value={query}
        oninput={() => (activeFamily = null)}
      />
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
        aria-label="Changed"
        aria-pressed={changedOnly}
        onclick={() => (changedOnly = !changedOnly)}>Changed <small>{changedCount}</small></button
      >
      <div class="history">
        <button
          type="button"
          class="quiet"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={disabled || !past.length}
          onclick={undo}>↶</button
        ><button
          type="button"
          class="quiet"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          disabled={disabled || !future.length}
          onclick={redo}>↷</button
        >
      </div>
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
              onclick={() =>
                update(Object.fromEntries(Object.entries(state.overrides).filter(([name]) => validNames.has(name))))}
              >Remove unmatched overrides</button
            >
          </details>{/if}
      </div>
    {/if}
    <div class="workspace">
      <div class="block-browser" aria-busy={loading}>
        {#if loading}<p class="empty" role="status">Loading…</p>
        {:else if manifest && !allBlocks.length}<p class="empty">No recognized targets.</p>
        {:else if manifest && !visibleTargets.length}<p class="empty">No matching blocks.</p>
        {:else}
          <p class="hint">
            Drag across bars to paint · Click a bar for its exact value and modules · Shift/Ctrl-click to select ·
            Scroll over the active or selected bars to adjust · Alt for fine steps
          </p>
          {#each charts as { family, targets } (family.name)}
            <FamilyChart
              {family}
              {targets}
              lens={lenses[family.name] ?? ""}
              overrides={state.overrides}
              {matching}
              {selected}
              active={inspecting}
              {disabled}
              onchange={(changes, group) => update({ ...state.overrides, ...changes }, group)}
              onlens={(lens) => setLens(family.name, lens)}
              onreset={(names) => update(clearOverrides(state.overrides, names))}
              oninherit={(name) => change(name, null)}
              oninspect={inspect}
              onselect={select}
            />
          {/each}
        {/if}
      </div>
      {#if inspected && inspectedFamily}
        {@const family = inspectedFamily}
        <aside class="details" aria-label="Block details">
          <div class="details-head">
            <strong title={inspected.name}>{families.length > 1 ? `${family.label} · ` : ""}{inspected.label}</strong>
            <StrengthControl
              label={`Multiplier ${inspected.name}`}
              value={targetMultiplier(inspected.name, state.overrides)}
              {disabled}
              onchange={(value) => change(inspected.name, value)}
            />
            <button
              type="button"
              class="inherit"
              aria-label={`Inherit ${inspected.name}`}
              title="Inherit parent multiplier"
              disabled={disabled || !Object.hasOwn(state.overrides, inspected.name)}
              onclick={() => change(inspected.name, null)}>↺</button
            >
            {#if inspected.controls.length}
              <input
                class="module-search"
                aria-label="Search block modules"
                placeholder={`Find among ${inspected.controls.length} modules…`}
                bind:value={moduleQuery}
              />
            {/if}
            <button
              type="button"
              class="quiet close"
              aria-label="Close block details"
              onclick={() => (inspecting = null)}>×</button
            >
          </div>
          {#if inspected.controls.length}
            <div class="module-grid">
              {#each modules as control (control.name)}
                <div
                  class="module-row"
                  class:group={control.group}
                  class:explicit={Object.hasOwn(state.overrides, control.name)}
                >
                  <button
                    type="button"
                    class="module-name"
                    title={`${control.name}\nShow ${control.label} across ${family.label}`}
                    onclick={() => setLens(family.name, control.label)}>{control.label}</button
                  >
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
          {/if}
        </aside>
      {/if}
    </div>
    <footer>
      <label class="select-visible"
        ><input
          type="checkbox"
          aria-label="Select visible blocks"
          checked={allSelected}
          disabled={disabled || !visibleTargets.length}
          onchange={selectVisible}
        />{selected.size ? `${selected.size} selected` : "Select all visible"}</label
      >
      {#if selected.size}<button type="button" class="quiet" onclick={() => (selected = new SvelteSet())}>Clear</button
        >{/if}
      <div class="bulk-actions">
        <StrengthControl
          label="Selected multiplier"
          value={bulkValue}
          disabled={disabled || !selected.size}
          onchange={(value) => (bulkValue = value)}
        /><button
          type="button"
          title="Set the selected bars; nested module overrides stay unchanged"
          disabled={disabled || !selected.size}
          onclick={applyBulk}>Set selected</button
        ><button
          type="button"
          class="quiet"
          title="Remove overrides for the selected bars and their modules"
          disabled={disabled || !selected.size}
          onclick={resetSelected}>Reset selected</button
        >
      </div>
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
    --bar-neutral: #4b524c;
    --bar-raise: #d3a676;
    --bar-lower: #7ea6cc;
    width: min(1240px, calc(100vw - 48px));
    max-height: none;
    margin-top: 24px;
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
    max-height: calc(100dvh - 48px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px 10px;
    flex-shrink: 0;
  }
  header > :global(.lora-picker) {
    flex: 1;
    min-width: 0;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    flex-shrink: 0;
  }
  .actions button {
    padding: 5px 9px;
  }
  .dirty {
    margin-right: 4px;
    font-size: 11px;
    color: var(--accent);
    white-space: nowrap;
  }
  button.apply {
    background: var(--accent-bg);
    border-color: var(--accent-line);
  }
  .global {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--muted);
    flex-shrink: 0;
  }
  .toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 0 14px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .search {
    flex: 1;
    width: 80px;
    min-width: 140px;
    padding: 5px 8px;
    height: 29px;
    font-size: 12px;
  }
  button[aria-pressed="true"] {
    color: var(--accent);
    background: var(--accent-bg);
  }
  .families {
    display: flex;
    gap: 3px;
    overflow-x: auto;
    min-width: 0;
    flex-shrink: 1;
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
    flex-shrink: 0;
  }
  .history {
    display: flex;
    flex-shrink: 0;
  }
  .history button {
    width: 26px;
    padding: 2px 0;
    font-size: 14px;
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
    flex: 0 1 auto;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .block-browser {
    display: flex;
    flex-direction: column;
    gap: 22px;
    flex: 0 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    padding: 10px 16px 14px;
    scrollbar-width: thin;
  }
  .hint {
    margin: 0 0 -10px;
    font-size: 10.5px;
    color: var(--placeholder);
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
  .details {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    max-height: 40dvh;
    min-height: 0;
    border-top: 1px solid var(--border);
    background: var(--surface-1);
  }
  .details-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
  }
  .details-head strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .details-head .close {
    margin-left: auto;
    padding: 0;
    width: 22px;
    height: 22px;
    font-size: 17px;
  }
  .module-search {
    width: 240px;
    margin-left: 12px;
    padding: 4px 6px;
    height: 26px;
    font-size: 11px;
  }
  .module-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    column-gap: 18px;
    overflow: auto;
    padding: 0 12px 8px;
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
    padding: 2px 4px;
    border: 0;
    background: transparent;
    text-align: left;
    white-space: normal;
    font:
      11px/1.3 ui-monospace,
      monospace;
    overflow-wrap: anywhere;
  }
  .module-name:hover {
    color: var(--accent);
  }
  .module-row.group .module-name {
    font-weight: 600;
    color: var(--muted);
  }
  .module-row.explicit .module-name {
    color: var(--accent);
  }
  .empty {
    margin: 18px 10px;
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
  .select-visible input {
    width: 12px;
    height: 12px;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }
  footer button {
    font-size: 11px;
    padding: 4px 7px;
  }
  .bulk-actions {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-left: 8px;
  }
  .reset-all {
    margin-left: auto;
  }
  @media (max-width: 720px) {
    .lora-modal {
      width: calc(100vw - 16px);
      margin-top: 8px;
    }
    form {
      max-height: calc(100dvh - 16px);
    }
    header,
    .toolbar {
      gap: 7px;
      flex-wrap: wrap;
    }
    header > :global(.lora-picker),
    .search {
      flex-basis: 100%;
    }
    .actions {
      margin-left: auto;
    }
    .details {
      max-height: 50dvh;
    }
    .details-head {
      flex-wrap: wrap;
    }
    .module-search {
      order: 3;
      width: 100%;
      margin: 0;
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
  }
  @media (max-width: 440px) {
    header,
    .toolbar {
      padding-left: 10px;
      padding-right: 10px;
    }
    .block-browser {
      padding: 8px 10px;
    }
    .global {
      gap: 4px;
    }
  }
</style>
