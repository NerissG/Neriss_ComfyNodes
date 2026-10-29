<script lang="ts">
  import { onMount } from "svelte";
  import { z } from "zod";
  import type { ComfyNode } from "@/comfy/types";
  import App from "@/App.svelte";
  import { openResolutionPresetManager } from "@/resolution/library";
  import { connectResolutionSelector, RESOLUTION_SELECTOR_NODE_ID } from "@/resolution/selector";
  import { editorNodeIds, OPEN_EDITOR_EVENT } from "@/editor/models";
  import { stringifyEditorState, type EditorModel } from "@/editor/state";
  import { previewState } from "./fixtures";
  import { emptyStrengthState, LORA_NODE_ID } from "@/lora/state";
  import { openLoraEditor } from "@/lora/services";

  const params = new URLSearchParams(window.location.search);
  const requestedModel = z.enum(["moss", "ideogram"]).catch("moss").parse(params.get("model"));
  const saved = previewState(params.get("empty") === "1");
  let stateJson = params.get("state") ?? stringifyEditorState(saved);
  const node: ComfyNode = {
    id: "editor-preview",
    comfyClass: editorNodeIds[requestedModel],
    widgets: [
      { name: "state_json", value: stateJson },
      { name: "width", value: saved.width },
      { name: "height", value: saved.height },
    ],
    addWidget: (_type, name, value) => ({ name, value }),
    setDirtyCanvas: () => {
      const value = node.widgets?.find((widget) => widget.name === "state_json")?.value;
      if (typeof value === "string") stateJson = value;
    },
  };
  let selectorNames: string[] = [];
  let loraStateJson = params.get("loraState") ?? JSON.stringify(emptyStrengthState("demo.safetensors"));
  let loraModelStrength = 1;
  let loraClipStrength = 1;
  let loraSelection = "demo.safetensors";
  const loraNames = [
    "demo.safetensors",
    "other.safetensors",
    ...(params.get("loraLibrary") === "1"
      ? [
          ...Array.from(
            { length: 2000 },
            (_, index) => `Collection/Style/LoRA_${String(index).padStart(4, "0")}.safetensors`,
          ),
          "Anima/Style/gpt-image-2_anima_v1.safetensors",
          "Anima/Char/Sugaya-Nowa_anima-p3_v1.safetensors",
        ]
      : []),
  ];
  const loraNode: ComfyNode = {
    id: "lora-preview",
    comfyClass: LORA_NODE_ID,
    widgets: [
      { name: "lora_name", value: loraSelection, options: { values: loraNames } },
      { name: "strength_model", value: loraModelStrength },
      { name: "strength_clip", value: loraClipStrength },
      { name: "state_json", value: loraStateJson },
    ],
    addWidget: (_type, name, value) => ({ name, value }),
    setDirtyCanvas: () => {
      const selection = readLoraWidget("lora_name");
      if (typeof selection === "string") loraSelection = selection;
      const value = readLoraWidget("state_json");
      if (typeof value === "string") loraStateJson = value;
      const model = readLoraWidget("strength_model");
      const clip = readLoraWidget("strength_clip");
      if (typeof model === "number") loraModelStrength = model;
      if (typeof clip === "number") loraClipStrength = clip;
    },
  };
  function readLoraWidget(name: string): unknown {
    return loraNode.widgets?.find((widget) => widget.name === name)?.value;
  }
  let selectorValue = "My banner";
  const selector: ComfyNode = {
    id: "resolution-preview",
    comfyClass: RESOLUTION_SELECTOR_NODE_ID,
    widgets: [
      { name: "preset", value: selectorValue },
      { name: "preset_aspect_x", value: 7 },
      { name: "preset_aspect_y", value: 2 },
    ],
    addWidget: (_type, name, value) => ({ name, value }),
    setDirtyCanvas: () => {
      selectorNames = selector.widgets?.find((widget) => widget.name === "preset")?.options?.values ?? [];
    },
  };

  function open(model: EditorModel) {
    node.comfyClass = editorNodeIds[model];
    window.dispatchEvent(new CustomEvent(OPEN_EDITOR_EVENT, { detail: { node } }));
  }
  onMount(() => {
    connectResolutionSelector(selector);
    if (params.get("lora") === "1") openLoraEditor(loraNode);
    else if (params.get("manager") === "1") openResolutionPresetManager();
    else open(requestedModel);
    return () => selector.onRemoved?.call(selector);
  });
</script>

<main>
  <h1>Layout editor preview</h1>
  <p>This page uses the real editor with a local mock node. It does not connect to ComfyUI.</p>
  <button type="button" onclick={() => open("moss")}>Open MOSS editor</button>
  <button type="button" onclick={() => open("ideogram")}>Open Ideogram editor</button>
  <button type="button" onclick={openResolutionPresetManager}>Manage AR Presets</button>
  <button type="button" onclick={() => openLoraEditor(loraNode)}>Open Strength Editor</button>
  <label
    >Preview LoRA
    <select
      aria-label="Preview LoRA"
      bind:value={loraSelection}
      onchange={() => {
        const widget = loraNode.widgets?.find((item) => item.name === "lora_name");
        if (widget) widget.value = loraSelection;
      }}
      >{#each loraNames as name (name)}<option>{name}</option>{/each}</select
    >
  </label>
  <pre data-testid="lora-state">{loraStateJson}</pre>
  <p data-testid="lora-globals">MODEL {loraModelStrength} / CLIP {loraClipStrength}</p>
  <label
    >Resolution Selector preset
    <select
      bind:value={selectorValue}
      onchange={() => {
        const widget = selector.widgets?.find((item) => item.name === "preset");
        if (widget) {
          widget.value = selectorValue;
          widget.callback?.(selectorValue);
        }
      }}
    >
      {#each selectorNames as name (name)}<option value={name}>{name}</option>{/each}
    </select>
  </label>
  <p>Image uploads and style preset storage require ComfyUI; browser tests mock those endpoints explicitly.</p>
  <details>
    <summary>Mock node state</summary>
    <pre data-testid="saved-state">{stateJson}</pre>
  </details>
</main>
<App />

<style>
  :global(body) {
    margin: 0;
    background: #14161a;
    color: #e4e7ed;
    font-family: system-ui, sans-serif;
  }
  main {
    max-width: 800px;
    margin: 48px auto;
    padding: 24px;
  }
  button {
    padding: 10px 16px;
    margin-right: 8px;
    cursor: pointer;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
