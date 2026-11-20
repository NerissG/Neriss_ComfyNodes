import { isNodeOfType } from "@/comfy/nodes";
import type { ComfyNode } from "@/comfy/types";
import { ok } from "neverthrow";
import { importIdeogramText, previewIdeogram, type ImportMode } from "@/layout/ideogram/prompt";
import { importMossText, previewMoss } from "@/layout/moss/prompt";
import type { EditorModel, EditorState, PresetPart, PresetParts } from "./state";

export const editorNodeIds = { ideogram: "Neriss_IdeogramV4PromptEditor", moss: "Neriss_MossLayoutPromptEditor" };
export const editorTitles = { ideogram: "Ideogram 4 Prompt Editor", moss: "MOSS Layout Prompt Editor" };
const modelNames = { ideogram: "Ideogram 4", moss: "MOSS" };

export function editorModel(node: ComfyNode): EditorModel | null {
  if (isNodeOfType(node, editorNodeIds.ideogram)) return "ideogram";
  if (isNodeOfType(node, editorNodeIds.moss)) return "moss";
  return null;
}

export function importPromptText(model: EditorModel, state: EditorState, text: string, mode: ImportMode = "all") {
  return model === "moss" ? importMossText(state, text) : importIdeogramText(state, text, mode);
}

export function previewPrompt(model: EditorModel, state: EditorState) {
  return model === "moss" ? previewMoss(state) : ok(previewIdeogram(state));
}

export type PresetPartOption = { part: PresetPart; label: string };

// Ordered as shown in the presets panel. Every part belongs to at least one model.
export const presetPartOptions: Record<EditorModel, PresetPartOption[]> = {
  moss: [
    { part: "elements", label: "Items" },
    { part: "high_level_description", label: "Caption" },
    { part: "moss_meta", label: "Meta" },
    { part: "canvas", label: "Canvas" },
  ],
  ideogram: [
    { part: "elements", label: "Regions" },
    { part: "high_level_description", label: "Description" },
    { part: "background", label: "Background" },
    { part: "style_description", label: "Style" },
    { part: "canvas", label: "Canvas" },
  ],
};

export function presetOptions(model: EditorModel, parts: PresetParts): PresetPartOption[] {
  return presetPartOptions[model].filter(({ part }) => parts[part] !== undefined);
}

/** Lists a preset's contents; parts only the other editor uses are marked with its name. */
export function presetSummary(model: EditorModel, parts: PresetParts): string {
  const other = model === "moss" ? "ideogram" : "moss";
  const foreign = presetOptions(other, parts).filter(
    ({ part }) => !presetPartOptions[model].some((option) => option.part === part),
  );
  const describe = ({ part, label }: PresetPartOption) => {
    if (part === "canvas" && parts.canvas) return `${label} ${parts.canvas.width}×${parts.canvas.height}`;
    const count = part === "elements" ? parts.elements?.length : part === "moss_meta" ? parts.moss_meta?.length : null;
    return count == null ? label : `${label} ${count}`;
  };
  return [
    ...presetOptions(model, parts).map(describe),
    ...foreign.map((option) => `${describe(option)} (${modelNames[other]} only)`),
  ].join(" · ");
}
