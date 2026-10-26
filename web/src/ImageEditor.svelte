<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { on } from "svelte/events";
  import { z } from "zod";
  import type { ComfyNode } from "@/comfy/types";
  import { parseComfyNode } from "@/comfy/guards";
  import { editorErrors, formatAppError, type AppError } from "@/errors";
  import {
    createInitialState,
    encodeEditorState,
    editorStateSchema,
    matchImageDimensions,
    parseEditorState,
    stringifyEditorState,
    type EditorModel,
    type EditorState,
  } from "@/editor/state";
  import {
    editorModel,
    editorTitles,
    importPromptText,
    OPEN_EDITOR_EVENT,
    previewPrompt,
    STATE_UPDATED_EVENT,
  } from "@/editor/models";
  import {
    readClipboardImage,
    readClipboardText,
    readWidgetValue,
    uploadReferenceImage,
    writeClipboardText,
    writeWidgetValue,
    type ReferenceImage,
  } from "@/editor/services";
  import { createHistory, recordHistory, redoHistory, undoHistory } from "@/editor/history";
  import { removeRegions } from "@/editor/regions";
  import { canvasTools, type CanvasTool } from "@/editor/tools";
  import { uiSettings } from "@/settings/store";
  import { matchShortcut, shortcutLabel, type CommandId } from "@/settings/shortcuts";
  import SettingsDialog from "@/settings/SettingsDialog.svelte";
  import type { ImportMode } from "@/ideogram/prompt";
  import LayoutCanvas from "@/editor/LayoutCanvas.svelte";
  import CanvasControls from "@/editor/CanvasControls.svelte";
  import RegionPanel from "@/editor/RegionPanel.svelte";
  import IdeogramControls from "@/ideogram/IdeogramControls.svelte";
  import MossControls from "@/moss/MossControls.svelte";
  import "@/editor/editor.css";

  let state = createInitialState();
  let history = createHistory(state);
  let node: ComfyNode | null = null;
  let model: EditorModel = "ideogram";
  let error: string | null = null;
  let notice: string | null = null;
  let invalidState: string | null = null;
  let confirmReset = false;
  let showJson = false;
  let showMenu = false;
  let showSettings = false;
  let session = 0;
  let imageRequest = 0;
  let loadingImage = false;
  let tool: CanvasTool = "select";
  let focused = false;
  let overlays = true;
  let showImage = true;
  let showGrid = false;
  let hoveredId: string | null = null;
  let checkedIds: string[] = [];
  let sidebarOpen = true;
  let sidebarWidth = 390;
  const sidebarTabs = [
    { id: "regions", label: "Regions", command: "panel.regions" },
    { id: "scene", label: "Scene & style", command: "panel.scene" },
    { id: "canvas", label: "Canvas", command: "panel.canvas" },
  ] satisfies { id: string; label: string; command: CommandId }[];
  let activeTab = "regions";
  let editGroup: string | null = null;
  let focusCounter = 0;
  let canvas: LayoutCanvas | undefined;
  let previousFocus: Element | null = null;
  let resizeStart: { x: number; width: number } | null = null;
  $: jsonPreview = previewPrompt(model, state);
  $: checkedIds = checkedIds.filter((id) => state.elements.some((region) => region.id === id));
  const eventSchema = z.object({ node: z.unknown() });
  const updateSchema = eventSchema.extend({ state: editorStateSchema });
  $: shortcuts = $uiSettings.settings.editor.shortcuts;
  $: persistedSidebarWidth = $uiSettings.settings.editor.sidebarWidth;
  $: sidebarWidth = persistedSidebarWidth;

  function savePreferences() {
    void uiSettings.saveEditor({ sidebarWidth });
  }

  function setError(value: AppError) {
    error = formatAppError(value);
    notice = null;
  }
  function setNotice(value: string) {
    notice = value;
    error = null;
  }
  function writeState() {
    if (!node || invalidState !== null) return;
    writeWidgetValue(node, "state_json", stringifyEditorState(state));
    writeWidgetValue(node, "width", state.width);
    writeWidgetValue(node, "height", state.height);
  }
  function persist(next: EditorState, commit = true) {
    if (invalidState !== null) return;
    if (commit) {
      const encoded = encodeEditorState(next);
      if (encoded.isErr()) {
        setError(encoded.error);
        return;
      }
    }
    notice = null;
    if (next.selected_region_id && next.selected_region_id !== state.selected_region_id) {
      activeTab = "regions";
      sidebarOpen = true;
    }
    state = next;
    if (commit) {
      history = recordHistory(history, next, editGroup);
      writeState();
    }
  }
  function undo() {
    notice = null;
    canvas?.cancelInteraction();
    history = undoHistory(history);
    state = history.present;
    editGroup = null;
    checkedIds = [];
    writeState();
    canvas?.focusCanvas();
  }
  function redo() {
    notice = null;
    canvas?.cancelInteraction();
    history = redoHistory(history);
    state = history.present;
    editGroup = null;
    checkedIds = [];
    writeState();
    canvas?.focusCanvas();
  }
  function remove(ids: string[]) {
    const next = removeRegions(state, ids);
    const count = state.elements.length - next.elements.length;
    if (!count) return;
    canvas?.cancelInteraction();
    persist(next);
    checkedIds = [];
    hoveredId = null;
    if (!state.selected_region_id) focused = false;
    setNotice(`Deleted ${count} ${count === 1 ? "region" : "regions"}. Use Undo to restore.`);
  }
  function openEditor(event: Event) {
    if (!(event instanceof CustomEvent)) return;
    const detail = eventSchema.safeParse(event.detail);
    if (!detail.success) return;
    const parsed = parseComfyNode(detail.data.node);
    if (parsed.isErr()) {
      setError(parsed.error);
      return;
    }
    const nextModel = editorModel(parsed.value);
    if (!nextModel) return;
    previousFocus = document.activeElement;
    model = nextModel;
    session += 1;
    node = parsed.value;
    showJson = false;
    showMenu = false;
    showSettings = false;
    void uiSettings.ensureLoaded();
    notice = null;
    error = null;
    loadingImage = false;
    tool = "select";
    focused = false;
    overlays = true;
    showImage = true;
    checkedIds = [];
    hoveredId = null;
    sidebarOpen = true;
    activeTab = "regions";
    editGroup = null;
    invalidState = null;
    confirmReset = false;
    const raw = readWidgetValue(node, "state_json");
    const saved = parseEditorState(raw);
    if (saved.isErr()) {
      setError(saved.error);
      invalidState = typeof raw === "string" ? raw : (JSON.stringify(raw) ?? "");
      state = createInitialState();
    } else state = saved.value;
    history = createHistory(state);
  }
  function stateUpdated(event: Event) {
    if (!(event instanceof CustomEvent) || !node || invalidState !== null) return;
    const detail = updateSchema.safeParse(event.detail);
    if (!detail.success) return;
    const parsed = parseComfyNode(detail.data.node);
    if (parsed.isOk() && parsed.value.id === node.id) {
      canvas?.cancelInteraction();
      state = detail.data.state;
      history = createHistory(state);
      checkedIds = [];
    }
  }
  function closeEditor() {
    showSettings = false;
    canvas?.cancelInteraction();
    session += 1;
    node = null;
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
  function downloadInvalidState() {
    if (invalidState === null) return;
    const url = URL.createObjectURL(new Blob([invalidState], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "neriss-editor-state.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function resetInvalidState() {
    if (!confirmReset) {
      confirmReset = true;
      return;
    }
    invalidState = null;
    state = createInitialState();
    history = createHistory(state);
    error = null;
    writeState();
  }
  async function importClipboard(mode: ImportMode = "all") {
    showMenu = false;
    const activeSession = session;
    const result = await readClipboardText();
    if (activeSession !== session) return;
    if (result.isErr()) {
      setError(result.error);
      return;
    }
    const imported = importPromptText(model, state, result.value, mode);
    if (imported.isErr()) {
      setError(imported.error);
      return;
    }
    canvas?.cancelInteraction();
    persist(imported.value);
    checkedIds = [];
    activeTab = "regions";
    setNotice("Imported prompt JSON. Use Undo to restore the previous layout.");
  }
  async function exportClipboard() {
    showMenu = false;
    if (jsonPreview.isErr()) {
      setError(jsonPreview.error);
      return;
    }
    const activeSession = session;
    const result = await writeClipboardText(jsonPreview.value);
    if (activeSession !== session) return;
    if (result.isErr()) setError(result.error);
    else setNotice("Copied prompt JSON.");
  }
  function applyImage(image: ReferenceImage) {
    canvas?.cancelInteraction();
    persist(
      matchImageDimensions(
        { ...state, reference_image_path: image.path, reference_image_name: image.name },
        image.width,
        image.height,
      ),
    );
    canvas?.fitCanvas();
    showImage = true;
    setNotice(`Reference image loaded. Canvas matched to ${image.width} × ${image.height}.`);
  }
  async function loadReference(file: File) {
    const activeSession = session;
    const request = ++imageRequest;
    loadingImage = true;
    const result = await uploadReferenceImage(file);
    if (activeSession !== session || request !== imageRequest) return;
    loadingImage = false;
    if (result.isErr()) setError(result.error);
    else applyImage(result.value);
  }
  async function importClipboardImage() {
    const activeSession = session;
    const request = ++imageRequest;
    loadingImage = true;
    const result = await readClipboardImage().andThen(uploadReferenceImage);
    if (activeSession !== session || request !== imageRequest) return;
    loadingImage = false;
    if (result.isErr()) setError(result.error);
    else applyImage(result.value);
  }
  function loadImage(event: Event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement) || !target.files?.[0]) return;
    void loadReference(target.files[0]);
    target.value = "";
  }
  function textTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }
  function keyboard(event: KeyboardEvent, target = event.target) {
    if (event.defaultPrevented || event.isComposing || showSettings) return;
    if (invalidState !== null) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (showJson) {
        showJson = false;
        return;
      }
      if (showMenu) {
        canvas?.dismissFileMenu();
        return;
      }
      if (canvas?.cancelInteraction()) return;
      if (textTarget(target) && target instanceof HTMLElement) {
        target.blur();
        return;
      }
      if (focused) {
        focused = false;
        return;
      }
      if (state.selected_region_id) {
        persist({ ...state, selected_region_id: null });
        return;
      }
      closeEditor();
      return;
    }
    if (textTarget(target) || showJson) return;
    const command = matchShortcut(event, shortcuts, "editor", model);
    if (!command) return;
    event.preventDefault();
    const nextTool = canvasTools.find((item) => item.command === command);
    if (nextTool) {
      canvas?.cancelInteraction();
      tool = nextTool.id;
      return;
    }
    const nextTab = sidebarTabs.find((tab) => tab.command === command);
    if (nextTab) {
      activeTab = nextTab.id;
      sidebarOpen = true;
      return;
    }
    switch (command) {
      case "history.undo":
        undo();
        break;
      case "history.redo":
        redo();
        break;
      case "selection.delete":
        remove(checkedIds.length ? checkedIds : state.selected_region_id ? [state.selected_region_id] : []);
        break;
      case "view.focus":
        if (state.selected_region_id || focused) focused = !focused;
        break;
      case "view.fitCanvas":
        canvas?.fitCanvas();
        break;
      case "view.zoomSelection":
        canvas?.zoomToSelection();
        break;
      case "view.toggleSidebar":
        sidebarOpen = !sidebarOpen;
        break;
    }
  }
  function isolateKeyboard(element: HTMLElement) {
    void tick().then(() => {
      if (node && element.isConnected) element.focus({ preventScroll: true });
    });
    // Preset management is mounted beside the editor, while settings is nested
    // inside it. Both native modals must keep ownership of focus and Escape.
    const activeModal = () => document.querySelector<HTMLDialogElement>("dialog.neriss-editor-theme:modal");
    const inside = (event: Event) => event.target instanceof Node && (activeModal() ?? element).contains(event.target);
    const stopPropagation = (event: Event) => event.stopPropagation();
    const keydown = (event: KeyboardEvent, target = event.target) => {
      keyboard(event, target);
      // Trap tab navigation inside the full-screen editor while retaining native field editing.
      if (event.key === "Tab" && !event.defaultPrevented) {
        const scope = element.querySelector<HTMLElement>(".text-field.expanded, .json-preview") ?? element;
        const controls = Array.from(
          scope.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, [tabindex="0"]'),
        ).filter((item) => item.getClientRects().length > 0 && !item.matches(":disabled"));
        const first = controls[0];
        const last = controls.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !scope.contains(document.activeElement) ||
            document.activeElement === element)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !scope.contains(document.activeElement) ||
            document.activeElement === element)
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
      event.stopPropagation();
    };
    // The host can restore graph focus or dispatch events outside the overlay.
    // Capture those before document-level graph handlers without intercepting
    // events inside the editor: its controls must retain native editing behavior.
    const captureKeyboard = (event: KeyboardEvent) => {
      if (!node || inside(event)) return;
      const modal = activeModal();
      if (modal) {
        modal.focus({ preventScroll: true });
        event.stopImmediatePropagation();
        return;
      }
      element.focus({ preventScroll: true });
      if (event.type === "keydown") keydown(event, element);
      const nativePaste =
        event.type === "keydown" &&
        (((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v") ||
          (event.shiftKey && event.key === "Insert"));
      if (!nativePaste) event.preventDefault();
      event.stopImmediatePropagation();
    };
    const captureFocus = (event: FocusEvent) => {
      if (!node || inside(event)) return;
      event.stopImmediatePropagation();
      (activeModal() ?? element).focus({ preventScroll: true });
    };
    const focusin = (event: FocusEvent) => {
      editGroup = textTarget(event.target) ? `field-${++focusCounter}` : null;
    };
    const focusout = () => {
      editGroup = null;
    };
    const paste = (event: ClipboardEvent) => {
      if (!node || (inside(event) && textTarget(event.target))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (invalidState !== null || activeModal() || showJson) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
      if (file) void loadReference(file);
    };
    const captureClipboard = (event: ClipboardEvent) => {
      if (!node || inside(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const removeListeners = [
      on(element, "keydown", (event) => keydown(event)),
      on(element, "keyup", stopPropagation),
      on(element, "keypress", stopPropagation),
      on(element, "paste", stopPropagation),
      on(element, "copy", stopPropagation),
      on(element, "cut", stopPropagation),
      on(window, "keydown", captureKeyboard, { capture: true }),
      on(window, "keyup", captureKeyboard, { capture: true }),
      on(window, "keypress", captureKeyboard, { capture: true }),
      on(window, "focusin", captureFocus, { capture: true }),
      on(window, "paste", paste, { capture: true }),
      on(window, "copy", captureClipboard, { capture: true }),
      on(window, "cut", captureClipboard, { capture: true }),
    ];
    element.addEventListener("focusin", focusin);
    element.addEventListener("focusout", focusout);
    return {
      destroy() {
        for (const remove of removeListeners) remove();
        element.removeEventListener("focusin", focusin);
        element.removeEventListener("focusout", focusout);
      },
    };
  }
  function resizeSidebar(event: PointerEvent) {
    if (!resizeStart) return;
    sidebarWidth = Math.round(Math.min(720, Math.max(300, resizeStart.width + resizeStart.x - event.clientX)));
  }

  window.addEventListener(OPEN_EDITOR_EVENT, openEditor);
  window.addEventListener(STATE_UPDATED_EVENT, stateUpdated);
  onDestroy(() => {
    window.removeEventListener(OPEN_EDITOR_EVENT, openEditor);
    window.removeEventListener(STATE_UPDATED_EVENT, stateUpdated);
  });
</script>

{#if node}
  <div
    class="neriss-layout-editor neriss-editor-theme"
    class:sidebar-hidden={!sidebarOpen || invalidState !== null}
    style={`--sidebar-width: ${sidebarWidth}px`}
    role="dialog"
    aria-modal="true"
    aria-label={editorTitles[model]}
    tabindex="-1"
    use:isolateKeyboard
  >
    {#if invalidState !== null}
      <section class="state-recovery" aria-label="Editor state recovery">
        <h2>Saved layout could not be opened</h2>
        <p role="alert">{error}</p>
        <p>The original state is unchanged. Download it for recovery, or explicitly replace it with an empty layout.</p>
        <div class="button-row wrap">
          <button type="button" onclick={downloadInvalidState}>Download original state</button>
          <button type="button" class="danger" onclick={resetInvalidState}
            >{confirmReset ? "Confirm replacement with empty layout" : "Reset layout…"}</button
          >
          <button type="button" onclick={closeEditor}>Close without changes</button>
        </div>
      </section>
    {:else}
      {#key session}
        <LayoutCanvas
          bind:this={canvas}
          {state}
          {model}
          bind:tool
          bind:focused
          bind:overlays
          bind:hoveredId
          bind:sidebarOpen
          {showImage}
          {showGrid}
          bind:showMenu
          statusMessage={loadingImage ? "Loading reference image…" : (error ?? notice)}
          statusError={!!error}
          ondismissstatus={() => {
            notice = null;
            error = null;
          }}
          onclose={closeEditor}
          onsettings={() => {
            showMenu = false;
            showSettings = true;
          }}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onchange={persist}
          onundo={undo}
          onredo={redo}
          onfile={loadReference}
          onerror={(message) => setError(editorErrors.runtime(message))}
        >
          <svelte:fragment slot="file-menu">
            <button type="button" title="Import JSON from clipboard" onclick={() => importClipboard()}
              ><svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true"
                ><path d="M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" /><rect
                  x="9"
                  y="2"
                  width="6"
                  height="5"
                  rx="1"
                /><path d="M12 11v7m-3-3 3 3 3-3" /></svg
              >Paste JSON</button
            >
            {#if model === "ideogram"}<button
                type="button"
                title="Import composition from clipboard"
                onclick={() => importClipboard("composition")}
                ><svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true"
                  ><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M9 10h12" /></svg
                >Paste layout</button
              ><button type="button" title="Import style from clipboard" onclick={() => importClipboard("style")}
                ><svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true"
                  ><path
                    d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 1.8-4.2 1 1 0 0 1 .7-1.8h1a4 4 0 0 0 4-4 8 8 0 0 0-9-8Z"
                  /><circle cx="7.5" cy="10" r=".75" /><circle cx="11" cy="7" r=".75" /><circle
                    cx="15.5"
                    cy="8.5"
                    r=".75"
                  /></svg
                >Paste style</button
              >{/if}
            <button type="button" title="Copy prompt JSON" onclick={exportClipboard}
              ><svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true"
                ><rect x="8" y="8" width="12" height="13" rx="2" /><path
                  d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"
                /></svg
              >Copy JSON</button
            >
            <button
              type="button"
              onclick={() => {
                showJson = true;
                showMenu = false;
              }}
              ><svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true"
                ><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg
              >Preview</button
            >
          </svelte:fragment>
        </LayoutCanvas>
      {/key}
      {#if sidebarOpen}
        <button
          class="sidebar-resizer"
          type="button"
          aria-label="Resize sidebar; use left and right arrow keys"
          onpointerdown={(event) => {
            resizeStart = { x: event.clientX, width: sidebarWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onpointermove={resizeSidebar}
          onpointerup={() => {
            resizeStart = null;
            savePreferences();
          }}
          onpointercancel={() => (resizeStart = null)}
          onkeydown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              event.stopPropagation();
              sidebarWidth = Math.max(300, Math.min(720, sidebarWidth + (event.key === "ArrowLeft" ? 20 : -20)));
              savePreferences();
            }
          }}
        ></button>
        <aside class="editor-sidebar">
          <nav class="sidebar-tabs" aria-label="Editor sections">
            {#each sidebarTabs as tab (tab.id)}<button
                type="button"
                class:active={activeTab === tab.id}
                aria-pressed={activeTab === tab.id}
                aria-keyshortcuts={shortcutLabel(tab.command, shortcuts, true) || undefined}
                title={`${tab.label}${shortcutLabel(tab.command, shortcuts) ? ` (${shortcutLabel(tab.command, shortcuts)})` : ""}`}
                onclick={() => (activeTab = tab.id)}>{tab.label}</button
              >{/each}
          </nav>
          <div class="sidebar-content">
            {#if activeTab === "regions"}<RegionPanel
                {state}
                {model}
                bind:hoveredId
                bind:checkedIds
                onchange={persist}
                onremove={remove}
                onredraw={(id) => {
                  canvas?.cancelInteraction();
                  persist({ ...state, selected_region_id: id });
                  overlays = true;
                  tool = "redraw";
                }}
                onzoom={() => canvas?.zoomToSelection()}
              />
            {:else if activeTab === "scene"}
              {#if model === "ideogram"}<IdeogramControls
                  {state}
                  onchange={persist}
                  onerror={setError}
                  onnotice={setNotice}
                />{:else}<MossControls {state} onchange={persist} />{/if}
            {:else}<CanvasControls
                {state}
                onchange={persist}
                onloadimage={loadImage}
                onclearimage={() => {
                  imageRequest += 1;
                  loadingImage = false;
                  persist({ ...state, reference_image_path: null, reference_image_name: null });
                }}
                onpasteimage={importClipboardImage}
                bind:showImage
                bind:showGrid
              />{/if}
          </div>
        </aside>
      {/if}
      {#if $uiSettings.error}
        <div class="ui-settings-error" role="alert">
          <span>UI settings: {formatAppError($uiSettings.error)}</span>
          <button
            type="button"
            disabled={$uiSettings.loading || $uiSettings.saving}
            onclick={() => {
              void uiSettings.retry();
            }}>Retry settings</button
          >
        </div>
      {/if}
      {#if showSettings}<SettingsDialog
          onclose={() => {
            showSettings = false;
            uiSettings.discardShortcutDraft();
          }}
        />{/if}
      {#if showJson}<section class="json-preview" aria-label="Prompt JSON preview">
          <div class="section-heading">
            <h2>Prompt JSON</h2>
            <div class="button-row">
              <button type="button" onclick={exportClipboard}>Copy JSON</button><button
                type="button"
                onclick={() => (showJson = false)}>Close preview</button
              >
            </div>
          </div>
          {#if jsonPreview.isOk()}<pre>{jsonPreview.value}</pre>{:else}<p class="field-error" role="alert">
              {jsonPreview.error.message}
            </p>{/if}
        </section>{/if}
    {/if}
  </div>
{/if}
