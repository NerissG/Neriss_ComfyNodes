import { mount } from "svelte";
import { z } from "zod";
import { configureComfyApi } from "@/comfy/api";
import App from "@/App.svelte";
import { comfyErrors } from "@/errors";
import { parseComfyAppModule, parseComfyNodeData } from "@/comfy/guards";
import type { ComfyMenuOption, ComfyNode, ComfyNodeData, ComfyNodeType } from "@/comfy/types";
import { encodeEditorState, parseEditorState, type EditorState } from "@/editor/state";
import { editorModel, editorNodeIds, importPromptText, OPEN_EDITOR_EVENT, STATE_UPDATED_EVENT } from "@/editor/models";
import { readWidgetValue, writeWidgetValue } from "@/editor/services";
import { openResolutionPresetManager } from "@/resolution/library";
import { LORA_NODE_ID } from "@/lora/state";
import { openLoraEditor } from "@/lora/services";
import {
  connectResolutionSelector,
  isResolutionSelectorNode,
  RESOLUTION_SELECTOR_NODE_ID,
} from "@/resolution/selector";

const OPEN_EDITOR_LABEL = "Open Layout Editor";
const APPLY_SIZE_LABEL = "Apply Size To Editor";
const APPLY_JSON_LABEL = "Apply JSON To Editor";
const APPLY_AVAILABLE_LABEL = "Apply Size + JSON";
const MANAGE_RESOLUTION_PRESETS_LABEL = "Manage AR Presets";

function openLayoutEditor(node: ComfyNode) {
  window.dispatchEvent(new CustomEvent(OPEN_EDITOR_EVENT, { detail: { node } }));
}

function findWidget(node: ComfyNode, name: string) {
  return node.widgets?.find((widget) => widget.name === name) ?? null;
}

function resizeNode(node: ComfyNode) {
  requestAnimationFrame(() => {
    const size = node.computeSize?.call(node);
    if (size) node.setSize?.call(node, size);
  });
  node.setDirtyCanvas?.call(node, true, true);
}

function readEditorState(node: ComfyNode): EditorState | null {
  const result = parseEditorState(readWidgetValue(node, "state_json"));
  if (result.isErr()) {
    console.error(result.error);
    return null;
  }
  return result.value;
}

function saveEditorState(node: ComfyNode, state: EditorState) {
  const encoded = encodeEditorState(state);
  if (encoded.isErr()) {
    console.error(encoded.error);
    return;
  }
  writeWidgetValue(node, "state_json", encoded.value);
  window.dispatchEvent(new CustomEvent(STATE_UPDATED_EVENT, { detail: { node, state } }));
}

function numericWidgetValue(node: ComfyNode, name: string): number | null {
  const value = readWidgetValue(node, name);
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.round(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : null;
  }
  return null;
}

function applySizeToEditor(node: ComfyNode) {
  const state = readEditorState(node);
  const width = numericWidgetValue(node, "width");
  const height = numericWidgetValue(node, "height");
  if (!state || width === null || height === null) return;
  saveEditorState(node, { ...state, width, height });
}

function applyJsonToEditor(node: ComfyNode) {
  const state = readEditorState(node);
  const model = editorModel(node);
  const value = readWidgetValue(node, "import_json");
  if (!state || !model || typeof value !== "string" || !value.trim()) return;
  const result = importPromptText(model, state, value);
  if (result.isErr()) {
    console.error(result.error);
    return;
  }
  saveEditorState(node, result.value);
}

function applyAvailableInputsToEditor(node: ComfyNode) {
  applySizeToEditor(node);
  applyJsonToEditor(node);
}

function addButton(node: ComfyNode, label: string, callback: () => void) {
  if (node.widgets?.some((widget) => widget.name === label)) return;
  node.addWidget.call(node, "button", label, null, callback);
}

function hideWidget(node: ComfyNode, name: string) {
  const widget = findWidget(node, name);
  if (!widget) return;
  widget.hidden = true;
  widget.type = "hidden";
  widget.computeSize = () => [0, -4];
  const inputIndex = node.inputs?.findIndex((input) => input.name === name) ?? -1;
  if (inputIndex !== -1) node.removeInput?.call(node, inputIndex);
  resizeNode(node);
}

function ensureResolutionSelectorControls(node: ComfyNode) {
  if (!isResolutionSelectorNode(node)) return;
  hideWidget(node, "preset_aspect_x");
  hideWidget(node, "preset_aspect_y");
  addButton(node, MANAGE_RESOLUTION_PRESETS_LABEL, openResolutionPresetManager);
  connectResolutionSelector(node);
}

function ensureLoraControls(node: ComfyNode) {
  if (node.comfyClass !== LORA_NODE_ID && node.type !== LORA_NODE_ID) return;
  hideWidget(node, "state_json");
  addButton(node, "Open Strength Editor", () => openLoraEditor(node));
}

function ensureOpenEditorButton(node: ComfyNode) {
  if (!editorModel(node)) return;
  hideWidget(node, "state_json");
  addButton(node, OPEN_EDITOR_LABEL, () => openLayoutEditor(node));
  addButton(node, APPLY_SIZE_LABEL, () => applySizeToEditor(node));
  addButton(node, APPLY_JSON_LABEL, () => applyJsonToEditor(node));
  addButton(node, APPLY_AVAILABLE_LABEL, () => applyAvailableInputsToEditor(node));
}

// The module is served by Vite in development, but Comfy's app must still come
// from the page's server (and respect its base URL).
const comfyAppModule = new URL("scripts/app.js", document.baseURI).href;
const comfyModule: unknown = await import(/* @vite-ignore */ comfyAppModule);
const comfyModuleResult = parseComfyAppModule(comfyModule);
const comfyApiModule: unknown = await import(/* @vite-ignore */ new URL("scripts/api.js", document.baseURI).href);
const apiModule = z.object({ api: z.unknown() }).safeParse(comfyApiModule);
if (apiModule.success) configureComfyApi(apiModule.data.api);

// Deliberately leave this entry without an HMR accept handler: Vite must reload
// the page when registration changes, rather than stacking extension hooks.
// Svelte components and CSS provide their own hot-update boundaries.
if (comfyModuleResult.isOk()) {
  const { app } = comfyModuleResult.value;
  app.registerExtension({
    name: "Neriss.ComfyNodes.LayoutEditor",
    async setup() {
      if (document.getElementById("neriss-layout-editor-root")) return;
      const host = document.createElement("div");
      host.id = "neriss-layout-editor-root";
      document.body.appendChild(host);
      mount(App, { target: host });
    },
    async beforeRegisterNodeDef(nodeType: ComfyNodeType, nodeData: ComfyNodeData) {
      const nodeDataResult = parseComfyNodeData(nodeData);
      if (nodeDataResult.isErr()) return;
      if (nodeDataResult.value.name === LORA_NODE_ID) {
        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreated() {
          originalOnNodeCreated?.call(this);
          ensureLoraControls(this);
        };
        return;
      }
      if (nodeDataResult.value.name === RESOLUTION_SELECTOR_NODE_ID) {
        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreated() {
          originalOnNodeCreated?.call(this);
          ensureResolutionSelectorControls(this);
        };
        const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function getExtraMenuOptions(
          graphCanvas: unknown,
          options: ComfyMenuOption[],
        ) {
          originalGetExtraMenuOptions?.call(this, graphCanvas, options);
          options.push({ content: MANAGE_RESOLUTION_PRESETS_LABEL, callback: openResolutionPresetManager });
        };
        return;
      }
      if (nodeDataResult.value.name !== editorNodeIds.ideogram && nodeDataResult.value.name !== editorNodeIds.moss)
        return;
      const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function onNodeCreated() {
        originalOnNodeCreated?.call(this);
        ensureOpenEditorButton(this);
      };
      const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
      nodeType.prototype.getExtraMenuOptions = function getExtraMenuOptions(
        graphCanvas: unknown,
        options: ComfyMenuOption[],
      ) {
        originalGetExtraMenuOptions?.call(this, graphCanvas, options);
        options.push({ content: OPEN_EDITOR_LABEL, callback: () => openLayoutEditor(this) });
        options.push({ content: APPLY_SIZE_LABEL, callback: () => applySizeToEditor(this) });
        options.push({ content: APPLY_JSON_LABEL, callback: () => applyJsonToEditor(this) });
        options.push({ content: APPLY_AVAILABLE_LABEL, callback: () => applyAvailableInputsToEditor(this) });
      };
    },
    async nodeCreated(node) {
      ensureOpenEditorButton(node);
      ensureResolutionSelectorControls(node);
      ensureLoraControls(node);
    },
  });
} else {
  console.error(comfyErrors.runtime("Could not register Comfy extension because the app module is unavailable"));
  console.error(comfyModuleResult.error);
}
