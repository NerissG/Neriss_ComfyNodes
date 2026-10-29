import { mount } from "svelte";
import { z } from "zod";
import { configureComfyApi } from "@/comfy/api";
import App from "@/App.svelte";
import { comfyErrors } from "@/errors";
import { parseComfyAppModule, parseComfyNodeData } from "@/comfy/guards";
import { addButton, extendNodeType, hideWidget, isNodeOfType, readWidgetValue, writeWidgetValue } from "@/comfy/nodes";
import type { ComfyNode, ComfyNodeData, ComfyNodeType } from "@/comfy/types";
import { encodeEditorState, parseEditorState, type EditorState } from "@/layout/state";
import { editorModel, editorNodeIds, importPromptText } from "@/layout/models";
import { LORA_NODE_ID } from "@/lora/state";
import { connectResolutionSelector, RESOLUTION_SELECTOR_NODE_ID } from "@/resolution/selector";
import { openLayoutEditor, openLoraEditor, openPresetEditor } from "@/views";

const OPEN_EDITOR_LABEL = "Open Layout Editor";
const APPLY_SIZE_LABEL = "Apply Size To Editor";
const APPLY_JSON_LABEL = "Apply JSON To Editor";
const APPLY_AVAILABLE_LABEL = "Apply Size + JSON";
const MANAGE_RESOLUTION_PRESETS_LABEL = "Manage AR Presets";

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

function ensureResolutionSelectorControls(node: ComfyNode) {
  if (!isNodeOfType(node, RESOLUTION_SELECTOR_NODE_ID)) return;
  hideWidget(node, "preset_aspect_x");
  hideWidget(node, "preset_aspect_y");
  addButton(node, MANAGE_RESOLUTION_PRESETS_LABEL, openPresetEditor);
  connectResolutionSelector(node);
}

function ensureLoraControls(node: ComfyNode) {
  if (!isNodeOfType(node, LORA_NODE_ID)) return;
  hideWidget(node, "state_json");
  addButton(node, "Open Strength Editor", () => openLoraEditor(node));
}

function ensureLayoutEditorControls(node: ComfyNode) {
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
      if (document.getElementById("neriss-root")) return;
      const host = document.createElement("div");
      host.id = "neriss-root";
      document.body.appendChild(host);
      mount(App, { target: host });
    },
    async beforeRegisterNodeDef(nodeType: ComfyNodeType, nodeData: ComfyNodeData) {
      const nodeDataResult = parseComfyNodeData(nodeData);
      if (nodeDataResult.isErr()) return;
      const name = nodeDataResult.value.name;
      if (name === LORA_NODE_ID) extendNodeType(nodeType, { created: ensureLoraControls });
      else if (name === RESOLUTION_SELECTOR_NODE_ID)
        extendNodeType(nodeType, {
          created: ensureResolutionSelectorControls,
          menu: () => [{ content: MANAGE_RESOLUTION_PRESETS_LABEL, callback: openPresetEditor }],
        });
      else if (name === editorNodeIds.ideogram || name === editorNodeIds.moss)
        extendNodeType(nodeType, {
          created: ensureLayoutEditorControls,
          menu: (node) => [
            { content: OPEN_EDITOR_LABEL, callback: () => openLayoutEditor(node) },
            { content: APPLY_SIZE_LABEL, callback: () => applySizeToEditor(node) },
            { content: APPLY_JSON_LABEL, callback: () => applyJsonToEditor(node) },
            { content: APPLY_AVAILABLE_LABEL, callback: () => applyAvailableInputsToEditor(node) },
          ],
        });
    },
    async nodeCreated(node) {
      ensureLayoutEditorControls(node);
      ensureResolutionSelectorControls(node);
      ensureLoraControls(node);
    },
  });
} else {
  console.error(comfyErrors.runtime("Could not register Comfy extension because the app module is unavailable"));
  console.error(comfyModuleResult.error);
}
