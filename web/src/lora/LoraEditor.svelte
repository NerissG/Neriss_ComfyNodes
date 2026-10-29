<script lang="ts">
  import { onMount } from "svelte";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { findWidget, readWidgetValue, writeWidgetValue } from "@/comfy/nodes";
  import type { ComfyNode } from "@/comfy/types";
  import { formatAppError } from "@/errors";
  import { createHistory, recordHistory, redoHistory, undoHistory, type History } from "@/shared/history";
  import Alert from "@/ui/Alert.svelte";
  import Dialog from "@/ui/Dialog.svelte";
  import Icon from "@/ui/Icon.svelte";
  import NumberField from "@/ui/NumberField.svelte";
  import SearchInput from "@/ui/SearchInput.svelte";
  import ToggleGroup from "@/ui/ToggleGroup.svelte";
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
  import { loadLoraTargets } from "./api";
  import { loraChoices } from "./picker";
  import LoraPicker from "./LoraPicker.svelte";
  import FamilyChart from "./FamilyChart.svelte";

  let { node, onclose }: { node: ComfyNode; onclose: () => void } = $props();
  type Draft = { history: History<StrengthState>; error: string };
  const strength: { min: number; max: number; step: "any"; nudge: number } = {
    min: -20,
    max: 20,
    step: "any",
    nudge: 0.05,
  };
  const stateKey = (state: StrengthState) => JSON.stringify(state);
  let search: SearchInput;

  function readNode(node: ComfyNode) {
    const selection = readWidgetValue(node, "lora_name");
    const loraName = typeof selection === "string" ? selection : "";
    const parsed = parseStrengthState(readWidgetValue(node, "state_json"));
    return {
      selection,
      loraName,
      choices: loraChoices(node),
      strengths: parsed.isOk() ? parsed.value : emptyStrengthState(loraName),
      error: parsed.isErr() ? `${formatAppError(parsed.error)}. Reset explicitly to replace the saved state.` : "",
      modelStrength: strengthSchema.catch(1).parse(readWidgetValue(node, "strength_model")),
      clipStrength: strengthSchema.catch(1).parse(readWidgetValue(node, "strength_clip")),
    };
  }
  // The editor is keyed by its node, so the node's widgets are read once when it opens.
  // svelte-ignore state_referenced_locally
  const saved = readNode(node);
  const choices = saved.choices;
  const drafts = new SvelteMap<string, Draft>();
  let loraName = $state(saved.loraName);
  let history = $state.raw(createHistory(saved.strengths));
  let stateError = $state(saved.error);
  let modelStrength = $state(saved.modelStrength);
  let clipStrength = $state(saved.clipStrength);
  let manifest = $state.raw<LoraManifest | null>(null);
  let loading = $state(true);
  let error = $state("");
  let query = $state("");
  let changedOnly = $state(false);
  let activeFamily = $state<string | null>(null);
  let lenses = $state<Record<string, string>>({});
  const selected = new SvelteSet<string>();
  let anchor = $state<string | null>(null);
  let inspecting = $state<string | null>(null);
  let moduleQuery = $state("");
  let bulkValue = $state(1);
  let mounted = false;
  let loadGeneration = 0;
  const strengths = $derived(history.present);
  const mismatch = $derived(Object.keys(strengths.overrides).length > 0 && strengths.lora_name !== loraName);
  const disabled = $derived(mismatch || Boolean(stateError));
  const families = $derived(buildBlockFamilies(manifest?.targets ?? []));
  const allBlocks = $derived(families.flatMap((family) => family.blocks));
  const familyFilters = $derived([
    { id: null, label: "All", count: allBlocks.length },
    ...families.map((family) => ({
      id: family.name,
      label: family.label,
      count: family.blocks.length,
      title: family.name || "Unnumbered targets",
    })),
  ]);
  const matching = $derived(
    new Set(
      filterBlockFamilies(families, query, changedOnly, strengths.overrides).flatMap((family) =>
        family.blocks.map((block) => block.name),
      ),
    ),
  );
  const visibleFamilies = $derived(
    families.filter(
      (family) =>
        (activeFamily === null || family.name === activeFamily) &&
        family.blocks.some((block) => matching.has(block.name)),
    ),
  );
  const charts = $derived(
    visibleFamilies.map((family) => ({ family, targets: familyTargets(family, lenses[family.name] ?? "") })),
  );
  const visibleTargets = $derived(
    charts.flatMap((chart) =>
      chart.targets.filter((target) => matching.has(target.block.name)).map((target) => target.name),
    ),
  );
  const allSelected = $derived(visibleTargets.length > 0 && visibleTargets.every((name) => selected.has(name)));
  const changedCount = $derived(allBlocks.filter((block) => blockChanged(block, strengths.overrides)).length);
  const overrideCount = $derived(Object.keys(strengths.overrides).length);
  const showClip = $derived(hasClipTargets(manifest?.targets ?? []) || clipStrength !== 1);
  const inspectedFamily = $derived(families.find((family) => family.blocks.some((block) => block.name === inspecting)));
  const inspected = $derived(inspectedFamily?.blocks.find((block) => block.name === inspecting));
  const modules = $derived(
    inspected?.controls.filter((control) =>
      `${control.name} ${control.label}`.toLowerCase().includes(moduleQuery.trim().toLowerCase()),
    ) ?? [],
  );
  const validNames = $derived(new Set((manifest?.targets ?? []).flatMap((name) => [...targetGroups(name), name])));
  const unused = $derived(Object.keys(strengths.overrides).filter((name) => !validNames.has(name)));

  onMount(() => {
    mounted = true;
    search.focus();
    void load();
    return () => {
      mounted = false;
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
    drafts.set(loraName, { history, error: stateError });
    loraName = name;
    const draft = drafts.get(name);
    history = draft?.history ?? createHistory(emptyStrengthState(name));
    stateError = draft?.error ?? "";
    query = "";
    changedOnly = false;
    activeFamily = null;
    lenses = {};
    selected.clear();
    anchor = null;
    inspecting = null;
    moduleQuery = "";
    void load();
  }
  function update(overrides: Record<string, number>, group: string | null = null) {
    history = recordHistory(history, { version: 1, lora_name: loraName, overrides }, stateKey, group);
  }
  function change(name: string, value: number | null) {
    const overrides = { ...strengths.overrides };
    if (value === null) delete overrides[name];
    else overrides[name] = value;
    update(overrides);
  }
  function reset() {
    update({});
    stateError = "";
  }
  function select(name: string, mode: "toggle" | "range") {
    const from = anchor === null ? -1 : visibleTargets.indexOf(anchor);
    const to = visibleTargets.indexOf(name);
    if (mode === "range" && from >= 0 && to >= 0) {
      for (const target of visibleTargets.slice(Math.min(from, to), Math.max(from, to) + 1)) selected.add(target);
    } else if (selected.has(name)) selected.delete(name);
    else selected.add(name);
    anchor = name;
  }
  function selectVisible() {
    const deselect = allSelected;
    for (const name of visibleTargets) {
      if (deselect) selected.delete(name);
      else selected.add(name);
    }
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
    selected.clear();
    anchor = null;
  }
  function keydown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || disabled) return;
    if (event.target instanceof HTMLInputElement && event.target.type !== "checkbox") return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) history = undoHistory(history);
    else if (key === "y" || (key === "z" && event.shiftKey)) history = redoHistory(history);
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
    if (readWidgetValue(node, "lora_name") !== saved.selection) {
      error = "LoRA selection changed. Cancel and reopen the editor.";
      return;
    }
    writeWidgetValue(node, "state_json", JSON.stringify({ ...strengths, lora_name: loraName }));
    writeWidgetValue(node, "strength_model", modelStrength);
    writeWidgetValue(node, "strength_clip", clipStrength);
    writeWidgetValue(node, "lora_name", loraName);
    findWidget(node, "lora_name")?.callback?.(loraName);
    onclose();
  }
</script>

{#snippet inheritButton(name: string)}
  <button
    type="button"
    class="inherit"
    aria-label={`Inherit ${name}`}
    title="Inherit parent multiplier"
    disabled={disabled || !Object.hasOwn(strengths.overrides, name)}
    onclick={() => change(name, null)}>↺</button
  >
{/snippet}

<Dialog label="LoRA block strength editor" width={1240} align="top" {onclose} onkeydown={keydown}>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      save();
    }}
  >
    <header>
      <LoraPicker {choices} value={loraName} onchange={selectLora} />
      <div class="global">
        <span>Model</span><NumberField
          compact
          label="MODEL strength"
          {...strength}
          value={modelStrength}
          onchange={(value) => (modelStrength = value)}
        />
      </div>
      {#if showClip}<div class="global">
          <span>Clip</span><NumberField
            compact
            label="CLIP strength"
            {...strength}
            value={clipStrength}
            onchange={(value) => (clipStrength = value)}
          />
        </div>{/if}
      <div class="actions">
        {#if overrideCount}<span class="dirty" role="status"
            >{overrideCount} override{overrideCount === 1 ? "" : "s"}</span
          >{/if}
        <button type="button" class="quiet" onclick={onclose}>Cancel</button><button
          type="submit"
          class="primary"
          disabled={loading || !manifest || disabled}>Apply strengths</button
        >
      </div>
    </header>
    <div class="toolbar">
      <SearchInput
        bind:this={search}
        class="target-search"
        label="Search LoRA targets"
        placeholder="Find block or module…"
        bind:value={query}
        oninput={() => (activeFamily = null)}
      />
      <ToggleGroup
        class="families"
        label="Block families"
        items={familyFilters}
        value={activeFamily}
        onselect={(id) => (activeFamily = id)}
      />
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
          disabled={disabled || !history.past.length}
          onclick={() => (history = undoHistory(history))}>↶</button
        ><button
          type="button"
          class="quiet"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          disabled={disabled || !history.future.length}
          onclick={() => (history = redoHistory(history))}>↷</button
        >
      </div>
    </div>
    {#if stateError || mismatch || error || manifest?.unsupported.length || (unused.length && !mismatch)}
      <div class="issues">
        {#if stateError}<Alert message={stateError} action={{ label: "Reset overrides", onclick: reset }} />{/if}
        {#if mismatch}<Alert
            message={`Overrides belong to ${strengths.lora_name}.`}
            action={{ label: "Reset overrides", onclick: reset }}
          />{/if}
        {#if error}<Alert message={error} action={{ label: "Retry inspection", onclick: () => void load() }} />{/if}
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
                update(
                  Object.fromEntries(Object.entries(strengths.overrides).filter(([name]) => validNames.has(name))),
                )}>Remove unmatched overrides</button
            >
          </details>{/if}
      </div>
    {/if}
    <div class="workspace">
      <div class="block-browser" aria-busy={loading}>
        {#if loading}<p class="empty-state" role="status">Loading…</p>
        {:else if manifest && !allBlocks.length}<p class="empty-state">No recognized targets.</p>
        {:else if manifest && !visibleTargets.length}<p class="empty-state">No matching blocks.</p>
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
              overrides={strengths.overrides}
              {matching}
              {selected}
              active={inspecting}
              {disabled}
              onchange={(changes, group) => update({ ...strengths.overrides, ...changes }, group)}
              onlens={(lens) => setLens(family.name, lens)}
              onreset={(names) => update(clearOverrides(strengths.overrides, names))}
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
            <NumberField
              compact
              label={`Multiplier ${inspected.name}`}
              {...strength}
              value={targetMultiplier(inspected.name, strengths.overrides)}
              {disabled}
              onchange={(value) => change(inspected.name, value)}
            />
            {@render inheritButton(inspected.name)}
            {#if inspected.controls.length}
              <SearchInput
                class="module-search"
                label="Search block modules"
                placeholder={`Find among ${inspected.controls.length} modules…`}
                bind:value={moduleQuery}
              />
            {/if}
            <button
              type="button"
              class="icon-button close"
              aria-label="Close block details"
              onclick={() => (inspecting = null)}><Icon name="close" size={14} /></button
            >
          </div>
          {#if inspected.controls.length}
            <div class="module-grid">
              {#each modules as control (control.name)}
                <div
                  class="module-row"
                  class:group={control.group}
                  class:explicit={Object.hasOwn(strengths.overrides, control.name)}
                >
                  <button
                    type="button"
                    class="module-name"
                    title={`${control.name}\nShow ${control.label} across ${family.label}`}
                    onclick={() => setLens(family.name, control.label)}>{control.label}</button
                  >
                  <NumberField
                    compact
                    label={`Multiplier ${control.name}`}
                    {...strength}
                    value={targetMultiplier(control.name, strengths.overrides)}
                    {disabled}
                    onchange={(value) => change(control.name, value)}
                  />
                  {@render inheritButton(control.name)}
                </div>
              {:else}<p class="empty-state">No matching modules.</p>{/each}
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
      {#if selected.size}<button type="button" class="quiet" onclick={() => selected.clear()}>Clear</button>{/if}
      <div class="bulk-actions">
        <NumberField
          compact
          label="Selected multiplier"
          {...strength}
          value={bulkValue}
          disabled={disabled || !selected.size}
          onchange={(value) => (bulkValue = value)}
        /><button
          type="button"
          title="Set the selected bars; nested module overrides stay unchanged"
          disabled={disabled || !selected.size}
          onclick={() => update(setBlockMultipliers(strengths.overrides, selected, bulkValue))}>Set selected</button
        ><button
          type="button"
          class="quiet"
          title="Remove overrides for the selected bars and their modules"
          disabled={disabled || !selected.size}
          onclick={() => update(clearOverrides(strengths.overrides, selected))}>Reset selected</button
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
</Dialog>

<style>
  form {
    --bar-neutral: #4b524c;
    --bar-raise: #d3a676;
    --bar-lower: #7ea6cc;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface-0);
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
  .toolbar :global(.target-search) {
    flex: 1;
    min-width: 140px;
  }
  .toolbar :global(.families) {
    flex-shrink: 1;
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
    width: 22px;
    height: 22px;
  }
  .details-head :global(.module-search) {
    width: 240px;
    height: 26px;
    margin-left: 12px;
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
    header,
    .toolbar {
      gap: 7px;
      flex-wrap: wrap;
    }
    header > :global(.lora-picker),
    .toolbar :global(.target-search) {
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
    .details-head :global(.module-search) {
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
