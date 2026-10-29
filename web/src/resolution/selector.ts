import type { ComfyNode } from "@/comfy/types";
import { findWidget, readWidgetValue, writeWidgetValue } from "@/comfy/nodes";
import { presetLibrary } from "./store";
import type { ResolutionPreset } from "./api";

export const RESOLUTION_SELECTOR_NODE_ID = "Neriss_ResolutionSelector";
const subscriptions = new WeakMap<ComfyNode, () => void>();

export function connectResolutionSelector(node: ComfyNode) {
  if (subscriptions.has(node)) return;
  const widget = findWidget(node, "preset");
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
