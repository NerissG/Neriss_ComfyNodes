<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    bboxFromPoints,
    clampCoord,
    fitImageFrame,
    moveBbox,
    resizeBbox,
    type Bbox,
    type Point,
    type ResizeHandle,
  } from "./geometry";
  import { createRegion, hasRegionBbox, type EditorModel, type EditorState, type PlacedRegion } from "./state";
  import { referenceImageUrl } from "./services";
  import { regionColor, regionTitle } from "./regions";
  import { canvasTools, type CanvasTool } from "./tools";
  import { uiSettings } from "@/settings/store";
  import { matchShortcut, shortcutLabel } from "@/settings/shortcuts";

  export let state: EditorState;
  export let model: EditorModel;
  export let tool: CanvasTool = "select";
  export let focused = false;
  export let overlays = true;
  export let showImage = true;
  export let showGrid = false;
  export let hoveredId: string | null = null;
  export let sidebarOpen = true;
  export let showMenu = false;
  export let statusMessage: string | null = null;
  export let statusError = false;
  export let ondismissstatus: () => void;
  export let onclose: () => void;
  export let onsettings: () => void;
  export let canUndo = false;
  export let canRedo = false;
  export let onchange: (state: EditorState, commit?: boolean) => void;
  export let onundo: () => void;
  export let onredo: () => void;
  export let onfile: (file: File) => void;
  export let onerror: (message: string) => void;

  type ImageFrame = ReturnType<typeof fitImageFrame>;
  type Interaction =
    | { type: "draw"; pointerId: number; start: Point; current: Point }
    | { type: "move"; pointerId: number; id: string; start: Point; box: Bbox }
    | { type: "resize"; pointerId: number; id: string; start: Point; box: Bbox; handle: ResizeHandle }
    | { type: "pan"; pointerId: number; start: Point; pan: Point };
  const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  let stage: SVGSVGElement;
  let wrap: HTMLDivElement;
  let fileMenuAnchor: HTMLDivElement;
  let fileMenuTrigger: HTMLButtonElement;
  let width = 1;
  let height = 1;
  let zoom = 1;
  let pan: Point = { x: 0, y: 0 };
  let interaction: Interaction | null = null;
  let spaceHeld = false;
  let dragImage = false;
  $: shortcuts = $uiSettings.settings.editor.shortcuts;
  $: fitted = fitImageFrame(state.width / state.height, Math.max(1, width - 160), Math.max(1, height - 64));
  $: frame = { ...fitted, x: fitted.x + 128, y: fitted.y + 32 };
  $: selected = state.elements.find((region) => region.id === state.selected_region_id);
  $: ordered = selected ? [...state.elements.filter((region) => region.id !== selected.id), selected] : state.elements;
  $: regions = (!overlays ? [] : focused ? (selected ? [selected] : []) : ordered).filter(hasRegionBbox);
  $: draft = interaction?.type === "draw" ? bboxFromPoints(interaction.start, interaction.current) : null;
  $: drawing = tool === "obj" || tool === "character" || tool === "text" || tool === "redraw";

  onMount(() => {
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        width = rect.width;
        height = rect.height;
      }
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  });

  export function fitCanvas() {
    zoom = 1;
    pan = { x: 0, y: 0 };
  }
  export function focusCanvas() {
    stage.focus({ preventScroll: true });
  }
  export function dismissFileMenu() {
    if (fileMenuAnchor?.contains(document.activeElement)) fileMenuTrigger.focus();
    showMenu = false;
  }
  export function zoomToSelection() {
    if (!selected?.bbox) return;
    zoom = Math.max(
      0.2,
      Math.min(
        12,
        Math.min(
          Math.max(1, width - 160) / Math.max(1, w(selected.bbox, frame)),
          (height - 100) / Math.max(1, h(selected.bbox, frame)),
        ),
      ),
    );
    pan = {
      x: (width + 96) / 2 - (x(selected.bbox, frame) + w(selected.bbox, frame) / 2) * zoom,
      y: height / 2 - (y(selected.bbox, frame) + h(selected.bbox, frame) / 2) * zoom,
    };
  }
  export function cancelInteraction(): boolean {
    const current = interaction;
    if (current) {
      interaction = null;
      if (stage.hasPointerCapture(current.pointerId)) stage.releasePointerCapture(current.pointerId);
      if (current.type === "move" || current.type === "resize") {
        onchange({
          ...state,
          elements: state.elements.map((region) =>
            region.id === current.id ? { ...region, bbox: current.box } : region,
          ),
        });
      } else if (current.type === "pan") pan = current.pan;
      return true;
    }
    if (tool !== "select") {
      tool = "select";
      return true;
    }
    return false;
  }
  function viewportPoint(event: PointerEvent | WheelEvent): Point {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function canvasPoint(event: PointerEvent): Point {
    const point = viewportPoint(event);
    return {
      x: clampCoord((((point.x - pan.x) / zoom - frame.x) / frame.width) * 1000),
      y: clampCoord((((point.y - pan.y) / zoom - frame.y) / frame.height) * 1000),
    };
  }
  function insideFrame(event: PointerEvent): boolean {
    const point = viewportPoint(event);
    const px = (point.x - pan.x) / zoom;
    const py = (point.y - pan.y) / zoom;
    return px >= frame.x && px <= frame.x + frame.width && py >= frame.y && py <= frame.y + frame.height;
  }
  function x(box: Bbox, frame: ImageFrame) {
    return frame.x + (box[1] / 1000) * frame.width;
  }
  function y(box: Bbox, frame: ImageFrame) {
    return frame.y + (box[0] / 1000) * frame.height;
  }
  function w(box: Bbox, frame: ImageFrame) {
    return ((box[3] - box[1]) / 1000) * frame.width;
  }
  function h(box: Bbox, frame: ImageFrame) {
    return ((box[2] - box[0]) / 1000) * frame.height;
  }
  function handleX(box: Bbox, handle: ResizeHandle, frame: ImageFrame) {
    return x(box, frame) + (handle.includes("w") ? 0 : handle.includes("e") ? w(box, frame) : w(box, frame) / 2);
  }
  function handleY(box: Bbox, handle: ResizeHandle, frame: ImageFrame) {
    return y(box, frame) + (handle.includes("n") ? 0 : handle.includes("s") ? h(box, frame) : h(box, frame) / 2);
  }
  function select(id: string | null) {
    onchange({ ...state, selected_region_id: id });
  }
  function cycle(point: Point) {
    // Cycle in document order, not the paint order that raises the current selection.
    const hits = state.elements
      .filter(hasRegionBbox)
      .filter((region) => regions.includes(region))
      .filter(({ bbox }) => point.y >= bbox[0] && point.x >= bbox[1] && point.y <= bbox[2] && point.x <= bbox[3])
      .reverse();
    if (hits.length)
      select(hits[(hits.findIndex((region) => region.id === state.selected_region_id) + 1) % hits.length].id);
  }
  function startPan(event: PointerEvent): boolean {
    if (event.button !== 1 && !event.altKey && !spaceHeld && tool !== "pan") return false;
    event.preventDefault();
    stage.focus({ preventScroll: true });
    stage.setPointerCapture(event.pointerId);
    interaction = { type: "pan", pointerId: event.pointerId, start: viewportPoint(event), pan: { ...pan } };
    return true;
  }
  function pointerDown(event: PointerEvent) {
    if (interaction) return;
    if (startPan(event)) return;
    if (event.button !== 0) return;
    event.preventDefault();
    stage.focus({ preventScroll: true });
    if (event.ctrlKey || event.metaKey) {
      cycle(canvasPoint(event));
      return;
    }
    if (!drawing) {
      select(null);
      return;
    }
    if (!insideFrame(event)) return;
    overlays = true;
    stage.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    interaction = { type: "draw", pointerId: event.pointerId, start: point, current: point };
  }
  function regionDown(event: PointerEvent, region: PlacedRegion, handle: ResizeHandle | undefined = undefined) {
    if (drawing) return;
    event.stopPropagation();
    if (interaction || startPan(event) || event.button !== 0) return;
    event.preventDefault();
    stage.focus({ preventScroll: true });
    const point = canvasPoint(event);
    if (event.ctrlKey || event.metaKey) {
      cycle(point);
      return;
    }
    stage.setPointerCapture(event.pointerId);
    select(region.id);
    const common = { pointerId: event.pointerId, id: region.id, start: point, box: region.bbox };
    interaction = handle ? { type: "resize", ...common, handle } : { type: "move", ...common };
  }
  function pointerMove(event: PointerEvent) {
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const point = viewportPoint(event);
    if (interaction.type === "pan") {
      pan = {
        x: interaction.pan.x + point.x - interaction.start.x,
        y: interaction.pan.y + point.y - interaction.start.y,
      };
      return;
    }
    const position = canvasPoint(event);
    if (interaction.type === "draw") {
      interaction = { ...interaction, current: position };
      return;
    }
    const dx = position.x - interaction.start.x;
    const dy = position.y - interaction.start.y;
    const bbox =
      interaction.type === "move"
        ? moveBbox(interaction.box, dx, dy)
        : resizeBbox(interaction.box, interaction.handle, dx, dy);
    const id = interaction.id;
    onchange(
      { ...state, elements: state.elements.map((region) => (region.id === id ? { ...region, bbox } : region)) },
      false,
    );
  }
  function pointerUp(event: PointerEvent) {
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const current = interaction;
    interaction = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (current.type === "draw") {
      const box = bboxFromPoints(current.start, canvasPoint(event));
      if (w(box, frame) * zoom < 4 || h(box, frame) * zoom < 4) return;
      if (tool === "redraw" && selected) {
        onchange({
          ...state,
          elements: state.elements.map((region) => (region.id === selected?.id ? { ...region, bbox: box } : region)),
        });
      } else {
        const region = createRegion(tool === "text" ? "text" : "obj", box);
        if (model === "moss") region.label = tool === "character" ? "character" : tool === "text" ? "text" : "object";
        onchange({ ...state, elements: [...state.elements, region], selected_region_id: region.id });
      }
      tool = "select";
    } else if (current.type !== "pan") onchange(state);
  }
  function cancelPointer(event: PointerEvent) {
    if (interaction?.pointerId === event.pointerId) cancelInteraction();
  }
  function zoomBy(factor: number, point: Point = { x: width / 2, y: height / 2 }) {
    const next = Math.max(0.2, Math.min(12, zoom * factor));
    pan = { x: point.x - ((point.x - pan.x) / zoom) * next, y: point.y - ((point.y - pan.y) / zoom) * next };
    zoom = next;
  }
  function keyboard(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === " " && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      spaceHeld = true;
      return;
    }
    if (event.key === "Enter" && event.target instanceof SVGElement) return;
    if (!selected?.bbox || interaction || drawing) return;
    const command = matchShortcut(event, shortcuts, "canvas", model);
    if (!command?.startsWith("canvas.")) return;
    const dx = command.startsWith("canvas.left") ? -1 : command.startsWith("canvas.right") ? 1 : 0;
    const dy = command.startsWith("canvas.up") ? -1 : command.startsWith("canvas.down") ? 1 : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    event.stopPropagation();
    const scale = command.endsWith("Fast") ? 10 : 1;
    const bbox = moveBbox(selected.bbox, (dx * scale * 1000) / state.width, (dy * scale * 1000) / state.height);
    onchange({
      ...state,
      elements: state.elements.map((region) => (region.id === selected?.id ? { ...region, bbox } : region)),
    });
  }
  function dropImage(event: DragEvent) {
    event.preventDefault();
    dragImage = false;
    const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith("image/"));
    if (file) onfile(file);
  }
</script>

<svelte:window
  onpointerdown={(event) => {
    if (event.target instanceof Node && !fileMenuAnchor?.contains(event.target)) showMenu = false;
  }}
/>

<main class="stage-panel">
  <div
    class="stage-wrap"
    class:drop-image={dragImage}
    bind:this={wrap}
    role="region"
    aria-label="Canvas; drop a reference image here"
    ondragover={(event) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        dragImage = true;
      }
    }}
    ondragleave={() => (dragImage = false)}
    ondrop={dropImage}
  >
    <div class="tool-palette" class:file-menu-open={showMenu} role="toolbar" aria-label="Canvas tools">
      <div class="tool-group" aria-label="Canvas tools">
        {#each canvasTools.filter((item) => model === "moss" || item.id !== "character") as item (item.id)}
          <button
            type="button"
            class:active={tool === item.id}
            aria-pressed={tool === item.id}
            aria-label={item.label}
            aria-keyshortcuts={shortcutLabel(item.command, shortcuts, true) || undefined}
            onclick={() => {
              cancelInteraction();
              tool = item.id;
            }}
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon} /></svg><span class="tool-tip"
              >{item.label}{#if shortcutLabel(item.command, shortcuts)}<kbd
                  >{shortcutLabel(item.command, shortcuts)}</kbd
                >{/if}{#if item.hint}<small>{item.hint}</small>{/if}</span
            ></button
          >
        {/each}
      </div>
      <div class="tool-group">
        <button
          type="button"
          disabled={!canUndo}
          onclick={onundo}
          aria-label="Undo"
          aria-keyshortcuts={shortcutLabel("history.undo", shortcuts, true) || undefined}
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg
          ><span class="tool-tip"
            >Undo{#if shortcutLabel("history.undo", shortcuts)}<kbd>{shortcutLabel("history.undo", shortcuts)}</kbd
              >{/if}</span
          ></button
        >
        <button
          type="button"
          disabled={!canRedo}
          onclick={onredo}
          aria-label="Redo"
          aria-keyshortcuts={shortcutLabel("history.redo", shortcuts, true) || undefined}
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg
          ><span class="tool-tip"
            >Redo{#if shortcutLabel("history.redo", shortcuts)}<kbd>{shortcutLabel("history.redo", shortcuts)}</kbd
              >{/if}</span
          ></button
        >
      </div>
      <div class="tool-group">
        <button
          type="button"
          class:active={focused}
          aria-pressed={focused}
          aria-label="Focus"
          aria-keyshortcuts={shortcutLabel("view.focus", shortcuts, true) || undefined}
          onclick={() => (focused = !focused)}
          ><svg viewBox="0 0 24 24" aria-hidden="true"
            ><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /></svg
          ><span class="tool-tip"
            >Show only the selected region{#if shortcutLabel("view.focus", shortcuts)}<kbd
                >{shortcutLabel("view.focus", shortcuts)}</kbd
              >{/if}</span
          ></button
        >
        <button
          type="button"
          class:active={!overlays}
          aria-pressed={!overlays}
          aria-label={overlays ? "Hide boxes" : "Show boxes"}
          onclick={() => (overlays = !overlays)}
          ><svg viewBox="0 0 24 24" aria-hidden="true"
            ><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle
              cx="12"
              cy="12"
              r="3"
            />{#if !overlays}<path d="M3 3l18 18" />{/if}</svg
          ><span class="tool-tip">{overlays ? "Hide boxes" : "Show boxes"}</span></button
        >
        <button
          type="button"
          aria-label={sidebarOpen ? "Hide panel" : "Edit panel"}
          aria-expanded={sidebarOpen}
          aria-keyshortcuts={shortcutLabel("view.toggleSidebar", shortcuts, true) || undefined}
          onclick={() => (sidebarOpen = !sidebarOpen)}
          ><svg viewBox="0 0 24 24" aria-hidden="true"
            ><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg
          ><span class="tool-tip"
            >{sidebarOpen ? "Hide panel" : "Edit panel"}{#if shortcutLabel("view.toggleSidebar", shortcuts)}<kbd
                >{shortcutLabel("view.toggleSidebar", shortcuts)}</kbd
              >{/if}</span
          ></button
        >
      </div>
      <div class="tool-group">
        <div
          class="file-menu-anchor"
          bind:this={fileMenuAnchor}
          role="group"
          aria-label="Import and export"
          onpointerenter={(event) => {
            if (event.pointerType === "mouse") showMenu = true;
          }}
          onpointerleave={(event) => {
            if (event.pointerType === "mouse") showMenu = false;
          }}
          onfocusin={() => (showMenu = true)}
          onfocusout={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
              showMenu = false;
          }}
        >
          <button
            bind:this={fileMenuTrigger}
            type="button"
            class:active={showMenu}
            aria-label="Import and export options"
            aria-expanded={showMenu}
            aria-controls="neriss-editor-file-menu"
            onclick={() => (showMenu = true)}
            onkeydown={async (event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.stopPropagation();
                showMenu = true;
                await tick();
                fileMenuAnchor.querySelector<HTMLButtonElement>(".file-menu button")?.focus();
              }
            }}
            ><svg viewBox="0 0 24 24" aria-hidden="true"
              ><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" /></svg
            ></button
          >
          {#if showMenu}
            <div id="neriss-editor-file-menu" class="file-menu" role="group" aria-label="Import and export actions">
              <slot name="file-menu" />
            </div>
          {/if}
        </div>
        <button type="button" aria-label="Editor settings" onclick={onsettings}
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6" /></svg><span
            class="tool-tip">Editor settings</span
          ></button
        >
        <button type="button" aria-label="Close editor" onclick={onclose}
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg><span class="tool-tip"
            >Close<kbd>Esc</kbd></span
          ></button
        >
      </div>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions (This application surface implements keyboard selection, nudging, and panning.) -->
    <svg
      bind:this={stage}
      role="application"
      tabindex="0"
      aria-label="Layout canvas"
      viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
      class:drawing
      class:panning={tool === "pan" || spaceHeld}
      onpointerdown={pointerDown}
      onpointermove={pointerMove}
      onpointerup={pointerUp}
      onpointercancel={cancelPointer}
      onlostpointercapture={cancelPointer}
      onwheel={(event) => {
        event.preventDefault();
        zoomBy(Math.exp(-event.deltaY * 0.0015), viewportPoint(event));
      }}
      onkeydown={keyboard}
      onkeyup={(event) => {
        if (event.key === " ") spaceHeld = false;
      }}
      onblur={() => (spaceHeld = false)}
    >
      <defs
        ><pattern id="neriss-layout-grid" width="40" height="40" patternUnits="userSpaceOnUse"
          ><path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.13)" stroke-width="1" /></pattern
        ></defs
      >
      <g transform={`matrix(${zoom} 0 0 ${zoom} ${pan.x} ${pan.y})`}>
        <rect class="canvas-frame" x={frame.x} y={frame.y} width={frame.width} height={frame.height} />
        {#if state.reference_image_path && showImage}<image
            href={referenceImageUrl(state.reference_image_path)}
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
            preserveAspectRatio={state.reference_image_fit === "stretch" ? "none" : "xMidYMid meet"}
            onerror={() => onerror("Reference image could not be loaded. Replace it in Canvas settings.")}
          />{/if}
        {#if showGrid}<rect
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
            fill="url(#neriss-layout-grid)"
            pointer-events="none"
          />{/if}
        {#each regions as region (region.id)}
          <g
            class="region"
            role="button"
            tabindex={drawing ? -1 : 0}
            aria-label={`Select ${regionTitle(region, state.elements.indexOf(region))}`}
            aria-pressed={region.id === state.selected_region_id}
            class:selected={region.id === state.selected_region_id}
            class:hovered={region.id === hoveredId}
            style={`--region-color: ${regionColor(region.id)}`}
            onpointerdown={(event) => regionDown(event, region)}
            onpointerenter={() => (hoveredId = region.id)}
            onpointerleave={() => (hoveredId = null)}
            onkeydown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                select(region.id);
              }
            }}
          >
            {#if region.id === state.selected_region_id}<rect
                class="selection-outline"
                x={x(region.bbox, frame)}
                y={y(region.bbox, frame)}
                width={w(region.bbox, frame)}
                height={h(region.bbox, frame)}
              />{/if}
            <rect
              class="region-rect"
              x={x(region.bbox, frame)}
              y={y(region.bbox, frame)}
              width={w(region.bbox, frame)}
              height={h(region.bbox, frame)}
            />
            {#if (region.id === state.selected_region_id || region.id === hoveredId) && !drawing}
              {@const title = regionTitle(region, state.elements.indexOf(region))}
              {@const shortTitle = title.length > 24 ? `${title.slice(0, 23)}…` : title}
              {@const label = `${String(state.elements.indexOf(region) + 1).padStart(2, "0")} · ${region.id === state.selected_region_id ? "Selected · " : ""}${shortTitle}`}
              <g
                class="region-label"
                transform={`translate(${x(region.bbox, frame)}, ${y(region.bbox, frame)}) scale(${1 / zoom})`}
              >
                <rect x="0" y="-26" width={label.length * 7 + 18} height="22" rx="4" />
                <text x="8" y="-11">{label}</text>
              </g>
            {/if}
            {#if region.id === state.selected_region_id && !drawing}
              {#each handles as handle (handle)}
                <g
                  class="handle"
                  style={`cursor: ${handle === "n" || handle === "s" ? "ns" : handle === "e" || handle === "w" ? "ew" : handle === "nw" || handle === "se" ? "nwse" : "nesw"}-resize`}
                  onpointerdown={(event) => regionDown(event, region, handle)}
                  role="presentation"
                >
                  <rect
                    x={handleX(region.bbox, handle, frame) - 11 / zoom}
                    y={handleY(region.bbox, handle, frame) - 11 / zoom}
                    width={22 / zoom}
                    height={22 / zoom}
                    fill="transparent"
                  />
                  <rect
                    class="resize-handle"
                    x={handleX(region.bbox, handle, frame) - 3 / zoom}
                    y={handleY(region.bbox, handle, frame) - 3 / zoom}
                    width={6 / zoom}
                    height={6 / zoom}
                  />
                </g>
              {/each}
            {/if}
          </g>
        {/each}
        {#if draft}<rect
            class="draft"
            x={x(draft, frame)}
            y={y(draft, frame)}
            width={w(draft, frame)}
            height={h(draft, frame)}
          />{/if}
      </g>
    </svg>
    {#if drawing}<div class="drawing-notice" role="status">
        {tool === "redraw"
          ? selected?.bbox
            ? "Draw a replacement box"
            : "Draw a box for the selected region"
          : `Drag to draw ${tool === "obj" ? "an object" : tool === "character" ? "a character" : "text"}`}<button
          type="button"
          class="quiet"
          onclick={() => {
            cancelInteraction();
            tool = "select";
          }}>Cancel · Esc</button
        >
      </div>{/if}
    {#if dragImage}<div class="drop-notice">Drop to use as reference image</div>{/if}
    <div class="zoom-controls">
      <button type="button" aria-label="Zoom out" onclick={() => zoomBy(1 / 1.25)}>−</button>
      <span title="Scroll to zoom">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in" onclick={() => zoomBy(1.25)}>+</button>
      <button
        type="button"
        onclick={fitCanvas}
        aria-keyshortcuts={shortcutLabel("view.fitCanvas", shortcuts, true) || undefined}
        title={shortcutLabel("view.fitCanvas", shortcuts)}>Fit</button
      >
      <button
        type="button"
        disabled={!selected?.bbox}
        onclick={zoomToSelection}
        aria-keyshortcuts={shortcutLabel("view.zoomSelection", shortcuts, true) || undefined}
        title={shortcutLabel("view.zoomSelection", shortcuts)}>To selection</button
      >
    </div>
    {#if statusMessage}<div class="status-message" class:error={statusError} role={statusError ? "alert" : "status"}>
        <span>{statusMessage}</span><button
          type="button"
          class="quiet"
          aria-label="Dismiss notification"
          onclick={ondismissstatus}>×</button
        >
      </div>{/if}
  </div>
</main>

<style>
  .stage-panel {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background: var(--surface-0);
  }
  .tool-palette {
    position: absolute;
    z-index: 1;
    left: 12px;
    top: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
    box-shadow: 0 8px 24px #0006;
  }
  .tool-palette.file-menu-open {
    z-index: 3;
  }
  .file-menu-anchor {
    position: relative;
  }
  .tool-group {
    display: grid;
    gap: 2px;
  }
  .tool-group + .tool-group {
    border-top: 1px solid var(--border);
    padding-top: 4px;
  }
  .tool-palette button {
    position: relative;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border-color: transparent;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
  }
  .tool-palette button:hover:not(:disabled) {
    background: var(--control-hover);
    border-color: transparent;
    color: var(--text);
  }
  .tool-palette button.active,
  .tool-palette button.active:hover {
    background: var(--accent-bg);
    border-color: var(--accent-line);
    color: var(--accent);
  }
  .tool-palette svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tool-tip {
    display: none;
    position: absolute;
    left: calc(100% + 10px);
    top: 50%;
    transform: translateY(-50%);
    grid-template-columns: auto 1fr;
    width: max-content;
    align-items: center;
    gap: 2px 6px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    box-shadow: 0 4px 12px #0006;
    pointer-events: none;
  }
  .tool-palette button:is(:hover, :focus-visible) .tool-tip {
    display: grid;
  }
  .tool-tip small {
    grid-column: 1 / -1;
    color: var(--muted);
    font-size: 11px;
  }
  .tool-tip kbd {
    justify-self: start;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--control-hover);
    color: var(--muted);
    font:
      11px/1.6 ui-monospace,
      monospace;
  }
  .stage-wrap {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    user-select: none;
  }
  .stage-wrap:has(svg[role="application"]:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--accent-line);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    outline: none;
  }
  .status-message {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: max(180px, calc(100% - 330px));
    padding: 5px 5px 5px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
    box-shadow: 0 8px 24px #0006;
    font-size: 12px;
  }
  .status-message span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status-message button {
    padding: 0 4px;
    line-height: 1;
  }
  .status-message.error {
    color: var(--danger);
  }

  svg.drawing {
    cursor: crosshair;
  }
  svg.panning {
    cursor: grab;
  }
  .drawing .region {
    pointer-events: none;
  }
  .region {
    outline: none;
  }
  .canvas-frame {
    fill: var(--surface-3);
    stroke: var(--border-strong);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .region-rect {
    fill: var(--region-color);
    fill-opacity: 0.025;
    stroke: var(--region-color);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    cursor: move;
  }
  .selection-outline {
    fill: none;
    stroke: #0d0d0d;
    stroke-width: 4;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .selected .region-rect {
    fill: var(--accent);
    fill-opacity: 0.09;
    stroke: var(--accent);
    stroke-width: 2;
  }
  .hovered .region-rect,
  .region:focus-visible .region-rect {
    stroke-width: 2;
  }
  .panning .region-rect {
    cursor: grab;
  }
  .region-label {
    pointer-events: none;
  }
  .region-label rect {
    fill: var(--surface-1);
    stroke: var(--region-color);
    stroke-width: 1;
  }
  .selected .region-label rect {
    fill: var(--accent);
    stroke: #0d0d0d;
  }
  .selected .region-label text {
    fill: var(--accent-ink);
    font-weight: 600;
  }
  .region-label text {
    fill: var(--text);
    font: 12px system-ui;
  }
  .resize-handle {
    fill: var(--accent);
    stroke: #0d0d0d;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .draft {
    fill: var(--accent);
    fill-opacity: 0.08;
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 5 3;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .zoom-controls {
    position: absolute;
    bottom: 16px;
    right: 16px;
    display: flex;
    gap: 3px;
    align-items: center;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 4px;
  }
  .zoom-controls span {
    min-width: 45px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-size: 12px;
  }
  .drawing-notice {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    white-space: nowrap;
    padding: 6px 12px;
    background: var(--surface-2);
    border: 1px solid var(--accent-line);
    border-radius: 8px;
    font-size: 13px;
  }
  .drop-image {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .drop-notice {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    background: var(--backdrop);
    font-size: 20px;
  }
</style>
