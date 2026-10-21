export type ComfyApp = {
  registerExtension(extension: ComfyExtension): void;
};

export type ComfyExtension = {
  name: string;
  setup?: () => void | Promise<void>;
  beforeRegisterNodeDef?: (nodeType: ComfyNodeType, nodeData: ComfyNodeData, app: ComfyApp) => void | Promise<void>;
  nodeCreated?: (node: ComfyNode) => void | Promise<void>;
};

export type ComfyNode = {
  id: number | string;
  comfyClass?: string;
  type?: string;
  widgets?: ComfyWidget[];
  inputs?: ComfyInputSlot[];
  addWidget(type: "button", name: string, value: unknown, callback: () => void): ComfyWidget;
  removeInput?: (index: number) => void;
  computeSize?: () => [number, number];
  setSize?: (size: [number, number]) => void;
  setDirtyCanvas?: (dirty: boolean, foreground: boolean) => void;
  onRemoved?: (this: ComfyNode) => void;
};

export type ComfyInputSlot = {
  name: string;
};

export type ComfyNodeType = {
  prototype: ComfyNodePrototype;
};

export type ComfyMenuOption = {
  content: string;
  callback: () => void;
};

export type ComfyNodePrototype = {
  onNodeCreated?: (this: ComfyNode) => void;
  getExtraMenuOptions?: (this: ComfyNode, graphCanvas: unknown, options: ComfyMenuOption[]) => void;
};

export type ComfyNodeData = {
  name: string;
};

export type ComfyWidget = {
  name: string;
  type?: string;
  hidden?: boolean;
  value?: unknown;
  options?: {
    values?: string[];
  };
  callback?: (value: unknown) => void;
  computeSize?: (width?: number) => [number, number];
};

export type ComfyAppModule = {
  app: ComfyApp;
};
