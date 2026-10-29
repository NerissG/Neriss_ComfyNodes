import type { ComfyMenuOption, ComfyNode, ComfyNodeType, ComfyWidget } from "@/comfy/types";

export function isNodeOfType(node: ComfyNode, id: string): boolean {
  return node.comfyClass === id || node.type === id;
}

export function findWidget(node: ComfyNode, name: string): ComfyWidget | null {
  return node.widgets?.find((widget) => widget.name === name) ?? null;
}

export function readWidgetValue(node: ComfyNode, name: string): unknown {
  return findWidget(node, name)?.value;
}

export function writeWidgetValue(node: ComfyNode, name: string, value: unknown) {
  const widget = findWidget(node, name);
  if (widget) {
    widget.value = value;
    node.setDirtyCanvas?.call(node, true, true);
  }
}

function resizeNode(node: ComfyNode) {
  requestAnimationFrame(() => {
    const size = node.computeSize?.call(node);
    if (size) node.setSize?.call(node, size);
  });
  node.setDirtyCanvas?.call(node, true, true);
}

export function hideWidget(node: ComfyNode, name: string) {
  const widget = findWidget(node, name);
  if (!widget) return;
  widget.hidden = true;
  widget.type = "hidden";
  widget.computeSize = () => [0, -4];
  const inputIndex = node.inputs?.findIndex((input) => input.name === name) ?? -1;
  if (inputIndex !== -1) node.removeInput?.call(node, inputIndex);
  resizeNode(node);
}

export function addButton(node: ComfyNode, label: string, callback: () => void) {
  if (node.widgets?.some((widget) => widget.name === label)) return;
  node.addWidget.call(node, "button", label, null, callback);
}

/** Chains node creation and context-menu hooks onto a node type, keeping the original handlers. */
export function extendNodeType(
  nodeType: ComfyNodeType,
  hooks: { created: (node: ComfyNode) => void; menu?: (node: ComfyNode) => ComfyMenuOption[] },
) {
  const { onNodeCreated, getExtraMenuOptions } = nodeType.prototype;
  nodeType.prototype.onNodeCreated = function () {
    onNodeCreated?.call(this);
    hooks.created(this);
  };
  const menu = hooks.menu;
  if (!menu) return;
  nodeType.prototype.getExtraMenuOptions = function (graphCanvas: unknown, options: ComfyMenuOption[]) {
    getExtraMenuOptions?.call(this, graphCanvas, options);
    options.push(...menu(this));
  };
}
