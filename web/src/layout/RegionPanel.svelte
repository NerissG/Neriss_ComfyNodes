<script lang="ts">
  import { tick } from "svelte";
  import { createRegion, type EditorModel, type EditorRegion, type EditorState } from "./state";
  import { fromCentralized, toCentralized, type Bbox } from "./geometry";
  import { canParentRegion, moveRegion, regionColor, regionOutline, regionTitle } from "./regions";
  import PaletteField from "./PaletteField.svelte";
  import TextField from "./TextField.svelte";
  import NumberField from "@/ui/NumberField.svelte";

  export let state: EditorState;
  export let model: EditorModel;
  export let hoveredId: string | null = null;
  export let checkedIds: string[] = [];
  export let onchange: (state: EditorState) => void;
  export let onremove: (ids: string[]) => void;
  export let onredraw: (id: string) => void;
  export let onzoom: () => void;
  let draggingId: string | null = null;
  let dropTarget: {
    id: string | null;
    parentId: string | null;
    slot: number;
    placement: "before" | "after" | "inside";
  } | null = null;
  let panel: HTMLElement;
  let list: HTMLDivElement;
  let coordinateError = "";
  $: selected = state.elements.find((region) => region.id === state.selected_region_id);
  $: outline = regionOutline(state.elements);
  $: siblings = state.elements.filter((region) => (region.parent_id ?? null) === (selected?.parent_id ?? null));
  $: siblingIndex = siblings.findIndex((region) => region.id === selected?.id);
  $: selectedType =
    model === "moss" ? (selected?.label ?? (selected?.type === "text" ? "text" : "object")) : selected?.type;
  $: typeOptions = [
    { value: model === "moss" ? "object" : "obj", label: "Object" },
    ...(model === "moss" ? [{ value: "character", label: "Character" }] : []),
    { value: "text", label: "Text" },
    ...(model === "moss" && selectedType && !["object", "character", "text"].includes(selectedType)
      ? [{ value: selectedType, label: selectedType }]
      : []),
  ];
  $: displayBbox = selected?.bbox
    ? model === "moss"
      ? toCentralized(selected.bbox, state.width, state.height)
      : selected.bbox.map(Math.round)
    : [];
  $: selectedId = state.selected_region_id;
  $: if (selectedId) void reveal(selectedId);
  $: if (selected) coordinateError = "";

  async function reveal(id: string) {
    await tick();
    const row = Array.from(panel?.querySelectorAll<HTMLElement>("[data-region-id]") ?? []).find(
      (element) => element.dataset.regionId === id,
    );
    row?.scrollIntoView({ block: "nearest" });
  }
  function update(change: Partial<EditorRegion>) {
    onchange({
      ...state,
      elements: state.elements.map((region) =>
        region.id === state.selected_region_id ? { ...region, ...change } : region,
      ),
    });
  }
  function updateBbox(index: number, value: number) {
    if (!selected?.bbox) return;
    const box: Bbox = model === "moss" ? toCentralized(selected.bbox, state.width, state.height) : [...selected.bbox];
    box[index] = value;
    if (box[0] >= box[2] || box[1] >= box[3]) {
      coordinateError = "Top must be above bottom, and left must be before right.";
      return;
    }
    coordinateError = "";
    update({ bbox: model === "moss" ? fromCentralized(box, state.width, state.height) : box });
  }
  function updateLabel(label: string) {
    if (label.trim()) update({ label: label.trim(), type: label === "text" ? "text" : "obj" });
  }
  function toggleChecked(id: string) {
    checkedIds = checkedIds.includes(id) ? checkedIds.filter((item) => item !== id) : [...checkedIds, id];
  }
  function addRegion(parent: EditorRegion | null) {
    const region = createRegion("obj");
    const next = { ...state, elements: [...state.elements, region], selected_region_id: region.id };
    onchange(moveRegion(next, region.id, parent?.id ?? null, state.elements.length + 1));
    if (parent) onredraw(region.id);
  }
  function setParent(parentId: string | null) {
    if (selected) onchange(moveRegion(state, selected.id, parentId, state.elements.length + 1));
  }
  async function zoomTo(region: EditorRegion) {
    onchange({ ...state, selected_region_id: region.id });
    await tick();
    onzoom();
  }
  function dragRoot(event: DragEvent, first: boolean) {
    if (!draggingId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropTarget = {
      id: null,
      parentId: null,
      slot: first ? 0 : state.elements.filter((region) => !region.parent_id).length,
      placement: first ? "before" : "after",
    };
  }
  function dragOver(event: DragEvent, region: EditorRegion, depth: number) {
    if (!draggingId || !(event.currentTarget instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const row = event.currentTarget.querySelector<HTMLElement>(".region-row");
    if (!row) return;
    const rect = row.getBoundingClientRect();
    let target = region;
    // The full-width indentation gutter remains a drop surface for outdenting.
    const desiredDepth = Math.max(0, Math.floor((event.clientX - list.getBoundingClientRect().left) / 14));
    while (event.clientX < rect.left && depth > desiredDepth && target.parent_id) {
      const parent = state.elements.find((item) => item.id === target.parent_id);
      if (!parent) return;
      target = parent;
      depth -= 1;
    }
    const inside =
      target.id === region.id &&
      event.clientX > rect.left + 60 &&
      event.clientY > rect.top + rect.height * 0.25 &&
      event.clientY < rect.bottom - rect.height * 0.25;
    const parentId = inside ? target.id : (target.parent_id ?? null);
    if (!canParentRegion(state.elements, draggingId, parentId) || target.id === draggingId) {
      dropTarget = null;
      return;
    }
    const items = state.elements.filter((item) => (item.parent_id ?? null) === parentId);
    const after = event.clientY > rect.top + rect.height / 2;
    dropTarget = {
      id: region.id,
      parentId,
      slot: inside ? items.length : items.findIndex((item) => item.id === target.id) + (after ? 1 : 0),
      placement: inside ? "inside" : after ? "after" : "before",
    };
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (draggingId && dropTarget) onchange(moveRegion(state, draggingId, dropTarget.parentId, dropTarget.slot));
    draggingId = null;
    dropTarget = null;
  }
</script>

<section class="regions-section" bind:this={panel}>
  <div class="section-heading">
    {#if state.elements.length}<input
        type="checkbox"
        aria-label="Select all regions"
        checked={checkedIds.length === state.elements.length}
        onchange={(event) =>
          (checkedIds = event.currentTarget.checked ? state.elements.map((region) => region.id) : [])}
      />{/if}
    <h2>Regions <span class="count">{state.elements.length}</span></h2>
    {#if checkedIds.length}<button type="button" class="quiet danger" onclick={() => onremove(checkedIds)}
        >Delete selected ({checkedIds.length})</button
      >{/if}
    <button type="button" class="quiet" onclick={() => addRegion(null)}>+ Region</button>
  </div>
  <div class="region-list" bind:this={list}>
    <div
      class="root-drop-target"
      class:dragging={!!draggingId}
      class:active={dropTarget?.id === null && dropTarget.placement === "before"}
      role="group"
      aria-label="Root level, first position"
      ondragover={(event) => dragRoot(event, true)}
      ondrop={drop}
    >
      Root level · first
    </div>
    {#each outline as { region, depth }, index (region.id)}
      <div
        class="region-item"
        class:active={region.id === state.selected_region_id}
        class:hovered={region.id === hoveredId}
        class:drop-before={dropTarget?.id === region.id && dropTarget.placement === "before"}
        class:drop-after={dropTarget?.id === region.id && dropTarget.placement === "after"}
        class:drop-child={dropTarget?.id === region.id && dropTarget.placement === "inside"}
        style={`--region-color: ${regionColor(region.id)}; --region-indent: ${Math.min(depth, 6) * 14}px`}
        data-depth={depth}
        role="group"
        aria-label={`Region ${index + 1}`}
        ondragover={(event) => dragOver(event, region, depth)}
        ondrop={drop}
        onpointerenter={() => (hoveredId = region.id)}
        onpointerleave={() => (hoveredId = null)}
      >
        <div class="region-row" data-region-id={region.id}>
          <button
            type="button"
            class="drag-handle quiet"
            draggable="true"
            aria-label={`Drag to reorder region ${index + 1}`}
            title="Drag onto a row’s center to nest, onto its edges to reorder, or into the left gutter to unnest"
            ondragstart={(event) => {
              draggingId = region.id;
              event.dataTransfer?.setData("text/plain", region.id);
              if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            }}
            ondragend={() => {
              draggingId = null;
              dropTarget = null;
            }}>⠿</button
          >
          <input
            type="checkbox"
            aria-label={`Select region ${index + 1} for bulk actions`}
            checked={checkedIds.includes(region.id)}
            onchange={() => toggleChecked(region.id)}
          />
          <button
            type="button"
            class="region-select"
            aria-pressed={region.id === state.selected_region_id}
            title={`${region.label ?? (region.type === "obj" ? "Object" : "Text")} · ${regionTitle(region, index)}${region.bbox ? "" : " · No box yet"}`}
            onclick={() => onchange({ ...state, selected_region_id: region.id })}
          >
            <span class="region-title">{regionTitle(region, index)}</span>
          </button>
          <button
            type="button"
            class="quiet region-icon"
            aria-label={region.bbox ? `Zoom to region ${index + 1}` : `Draw box for region ${index + 1}`}
            title={region.bbox ? "Zoom to region" : "No box yet — draw on canvas"}
            onclick={() => (region.bbox ? zoomTo(region) : onredraw(region.id))}
          >
            {#if region.bbox}<svg viewBox="0 0 16 16" aria-hidden="true"
                ><circle cx="6.5" cy="6.5" r="4" /><path d="m10 10 4 4M6.5 4.5v4M4.5 6.5h4" /></svg
              >{:else}<svg viewBox="0 0 16 16" aria-hidden="true"
                ><path d="M6 3H3v3M10 3h3v3M3 10v3h3M13 10v3h-3M8 5v6M5 8h6" /></svg
              >{/if}
          </button>
          <button
            type="button"
            class="quiet region-icon"
            aria-label={`Add child to region ${index + 1}`}
            title="Add child"
            onclick={() => addRegion(region)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2v8h5M11 6v8M7 10h8" /></svg>
          </button>
          <button
            type="button"
            class="quiet region-icon region-delete"
            aria-label={`Delete region ${index + 1}`}
            title="Delete region and its children"
            onclick={() => onremove([region.id])}
            ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button
          >
        </div>
      </div>
    {/each}
    <div
      class="root-drop-target"
      class:dragging={!!draggingId}
      class:active={dropTarget?.id === null && dropTarget.placement === "after"}
      role="group"
      aria-label="Root level, last position"
      ondragover={(event) => dragRoot(event, false)}
      ondrop={drop}
    >
      Root level · last
    </div>
  </div>
  {#if selected}
    {#key selected.id}
      {@const region = selected}
      <div class="region-details">
        <div class="region-detail-heading">
          <span class="selection-dot" aria-hidden="true"></span>
          <h2 title={regionTitle(region, state.elements.indexOf(region))}>
            {regionTitle(region, state.elements.indexOf(region))}
          </h2>
          <button type="button" class="quiet" onclick={() => onredraw(region.id)}
            >{region.bbox ? "Redraw" : "Draw box"}</button
          >
          <button
            type="button"
            class="quiet region-reorder"
            disabled={siblingIndex === 0}
            onclick={() => onchange(moveRegion(state, region.id, region.parent_id ?? null, siblingIndex - 1))}
            title="Move region up"
            aria-label="Move region up">↑</button
          >
          <button
            type="button"
            class="quiet region-reorder"
            disabled={siblingIndex === siblings.length - 1}
            onclick={() => onchange(moveRegion(state, region.id, region.parent_id ?? null, siblingIndex + 2))}
            title="Move region down"
            aria-label="Move region down">↓</button
          >
        </div>
        <div class="region-metadata">
          <div class="region-type-row" role="group" aria-label="Type">
            <span class="region-metadata-label" aria-hidden="true">Type</span>
            <div class="region-type-options">
              {#each typeOptions as option (option.value)}
                <button
                  type="button"
                  class:active={selectedType === option.value}
                  aria-label={`Set type to ${option.label}`}
                  aria-pressed={selectedType === option.value}
                  title={option.label}
                  onclick={() =>
                    model === "moss"
                      ? updateLabel(option.value)
                      : update({ type: option.value === "text" ? "text" : "obj" })}>{option.label}</button
                >
              {/each}
            </div>
          </div>
          <label class="region-parent"
            >Parent
            <select value={region.parent_id ?? ""} onchange={(event) => setParent(event.currentTarget.value || null)}>
              <option value="">None (root)</option>
              {#each outline.filter( (entry) => canParentRegion(state.elements, region.id, entry.region.id) ) as entry (entry.region.id)}
                <option value={entry.region.id}
                  >{"· ".repeat(entry.depth)}{regionTitle(entry.region, state.elements.indexOf(entry.region))}</option
                >
              {/each}
            </select>
          </label>
        </div>
        {#if region.type === "text" || (model === "ideogram" && region.text)}<TextField
            label="Literal text"
            value={region.text}
            placeholder="Exact words to appear in the image"
            onchange={(text) => update({ text })}
          />{/if}
        <TextField
          label={model === "moss" ? "Caption" : "Description"}
          value={region.desc}
          placeholder="Describe this element’s appearance, pose, and details…"
          onchange={(desc) => update({ desc })}
        />
        <details open>
          <summary>Palette{region.color_palette.length ? ` · ${region.color_palette.length}` : ""}</summary>
          <div class="detail-content">
            <PaletteField
              label="Region palette"
              colors={region.color_palette}
              limit={5}
              onchange={(color_palette) => update({ color_palette })}
            />
          </div>
        </details>
        {#if region.bbox}<details>
            <summary>Position &amp; size</summary>
            <div class="grid two detail-content">
              {#each ["Top (Y min)", "Left (X min)", "Bottom (Y max)", "Right (X max)"] as label, coordinate (label)}
                <NumberField
                  {label}
                  value={displayBbox[coordinate]}
                  min={model === "moss" ? -(coordinate % 2 === 0 ? state.height : state.width) / 2 : 0}
                  max={model === "moss" ? (coordinate % 2 === 0 ? state.height : state.width) / 2 : 1000}
                  onchange={(value) => updateBbox(coordinate, value)}
                />
              {/each}
            </div>
            {#if coordinateError}<p class="field-error">{coordinateError}</p>{/if}
            <p class="subtle">
              {model === "moss" ? "Pixels relative to the canvas center." : "Coordinates normalized to 0–1000."}
            </p>
          </details>{:else}<p class="subtle">
            No box yet. Draw this region on the canvas to set its position and size.
          </p>{/if}
        {#if model === "moss"}<details>
            <summary>Custom type</summary><label class="detail-content"
              >Label<input
                value={region.label ?? (region.type === "text" ? "text" : "object")}
                onchange={(event) => updateLabel(event.currentTarget.value)}
              /></label
            >
          </details>{/if}
      </div>
    {/key}
  {/if}
  {#if !state.elements.length}<div class="empty-state">
      <strong>Start with a region</strong>
      <p>Choose Object, Character, or Text in the canvas tools, then drag to draw a box.</p>
    </div>{/if}
</section>
