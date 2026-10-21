import type { ComfyNode } from "@/comfy/types";
import { ok } from "neverthrow";
import { importIdeogramText, previewIdeogram, type ImportMode } from "@/ideogram/prompt";
import { importMossText, previewMoss } from "@/moss/prompt";
import type { EditorModel, EditorState } from "./state";

export const editorNodeIds = { ideogram: "Neriss_IdeogramV4PromptEditor", moss: "Neriss_MossLayoutPromptEditor" };
export const editorTitles = { ideogram: "Ideogram 4 Prompt Editor", moss: "MOSS Layout Prompt Editor" };
export const OPEN_EDITOR_EVENT = "neriss-layout-editor:open";
export const STATE_UPDATED_EVENT = "neriss-layout-editor:state-updated";

export function editorModel(node: ComfyNode): EditorModel | null {
  if (node.comfyClass === editorNodeIds.ideogram || node.type === editorNodeIds.ideogram) return "ideogram";
  if (node.comfyClass === editorNodeIds.moss || node.type === editorNodeIds.moss) return "moss";
  return null;
}

export function importPromptText(model: EditorModel, state: EditorState, text: string, mode: ImportMode = "all") {
  return model === "moss" ? importMossText(state, text) : importIdeogramText(state, text, mode);
}

export function previewPrompt(model: EditorModel, state: EditorState) {
  return model === "moss" ? previewMoss(state) : ok(previewIdeogram(state));
}
