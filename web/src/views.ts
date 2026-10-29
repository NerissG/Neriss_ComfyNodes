import { writable } from "svelte/store";
import type { ComfyNode } from "@/comfy/types";

// The layout editor stays mounted to keep per-node undo history, so it is driven by its node.
// The preset editor can open above it from the canvas panel.
export const layoutEditorNode = writable<ComfyNode | null>(null);
export const loraEditorNode = writable<ComfyNode | null>(null);
export const presetEditorOpen = writable(false);

export function openLayoutEditor(node: ComfyNode) {
  layoutEditorNode.set(node);
}

export function openLoraEditor(node: ComfyNode) {
  loraEditorNode.set(node);
}

export function openPresetEditor() {
  presetEditorOpen.set(true);
}
