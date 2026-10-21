import type { ComfyNode } from "@/comfy/types";
import { readWidgetValue, writeWidgetValue } from "@/editor/services";
import { presetLibrary } from "./library";
import type { ResolutionPreset } from "./presets";

export const RESOLUTION_SELECTOR_NODE_ID = "Neriss_ResolutionSelector";
const subscriptions = new WeakMap<ComfyNode, () => void>();

export function isResolutionSelectorNode(node: ComfyNode): boolean {
  return node.comfyClass === RESOLUTION_SELECTOR_NODE_ID || node.type === RESOLUTION_SELECTOR_NODE_ID;
}

export function connectResolutionSelector(node: ComfyNode) {
  if (subscriptions.has(node)) return;
  const widget = node.widgets?.find((item) => item.name === "preset");
  if (!widget) return;

  let presets: ResolutionPreset[] = [];
  const originalCallback = widget.callback;
  widget.callback = (value: unknown) => {
    originalCallback?.(value);
    const selected = presets.find((preset) => preset.name === value);
    if (selected) {
      writeWidgetValue(node, "preset_aspect_x", selected.x);
      writeWidgetValue(node, "preset_aspect_y", selected.y);
    }
    node.setDirtyCanvas?.call(node, true, true);
  };

  const unsubscribe = presetLibrary.subscribe((library) => {
    if (!library.loaded) return;
    presets = library.presets;
    const names = presets.map((preset) => preset.name);
    const current = readWidgetValue(node, "preset");
    // Library edits do not change an existing node's selected ratio snapshot.
    if (typeof current === "string" && current.trim() && !names.includes(current)) names.unshift(current);
    widget.type = "combo";
    widget.options = { ...widget.options, values: names };
    if (typeof current !== "string" || !current.trim()) {
      widget.value = names[0];
      widget.callback?.(widget.value);
    }
    node.setDirtyCanvas?.call(node, true, true);
  });
  subscriptions.set(node, unsubscribe);
  const originalOnRemoved = node.onRemoved;
  node.onRemoved = function onRemoved() {
    unsubscribe();
    subscriptions.delete(node);
    widget.callback = originalCallback;
    node.onRemoved = originalOnRemoved;
    originalOnRemoved?.call(node);
  };
  void presetLibrary.ensureLoaded().mapErr((error) => console.error(error));
}
