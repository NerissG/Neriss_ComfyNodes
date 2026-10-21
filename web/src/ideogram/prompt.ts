import { err, ok } from "neverthrow";
import { parseBoundedJson } from "@/editor/limits";
import { editorErrors } from "@/errors";
import { createRegion, type EditorState, type EditorStyle } from "@/editor/state";
import { regionOutline } from "@/editor/regions";
import {
  ideogramImportSchema,
  toIdeogramV4PrettyJsonString,
  type IdeogramV4Element,
  type IdeogramV4JsonPrompt,
  type IdeogramV4StyleDescription,
} from "./schema";

export type ImportMode = "all" | "composition" | "style";

export function buildPrompt(state: EditorState): IdeogramV4JsonPrompt {
  const elements: IdeogramV4Element[] = regionOutline(state.elements).map(({ region }) => {
    const bbox: [number, number, number, number] | null =
      region.bbox === null
        ? null
        : [
            Math.round(region.bbox[0]),
            Math.round(region.bbox[1]),
            Math.round(region.bbox[2]),
            Math.round(region.bbox[3]),
          ];
    const position = bbox === null ? {} : { bbox };
    const palette = region.color_palette.length ? { color_palette: region.color_palette } : {};
    return region.type === "text"
      ? { type: "text", ...position, text: region.text, desc: region.desc, ...palette }
      : { type: "obj", ...position, desc: region.desc, ...palette };
  });
  const style = state.style_description;
  return {
    high_level_description: state.high_level_description,
    style_description: {
      aesthetics: style.aesthetics,
      lighting: style.lighting,
      medium: style.medium,
      ...(style.mode === "photo" ? { photo: style.photo } : { art_style: style.art_style }),
      ...(style.color_palette.length ? { color_palette: style.color_palette } : {}),
    },
    compositional_deconstruction: { background: state.background, elements },
  };
}

function importStyle(style: IdeogramV4StyleDescription, current: EditorStyle): EditorStyle {
  return { ...current, ...style, mode: "photo" in style ? "photo" : "art", color_palette: style.color_palette ?? [] };
}

export function importPromptIntoState(
  state: EditorState,
  prompt: IdeogramV4JsonPrompt,
  mode: ImportMode = "all",
): EditorState {
  const next = { ...state, selected_region_id: null };
  if (mode === "all") next.high_level_description = prompt.high_level_description ?? "";
  if (mode !== "style") {
    next.background = prompt.compositional_deconstruction.background;
    next.elements = prompt.compositional_deconstruction.elements.map((element) => ({
      ...createRegion(element.type, element.bbox ?? null),
      desc: element.desc,
      text: element.type === "text" ? element.text : "",
      color_palette: element.color_palette ?? [],
    }));
  }
  if (mode !== "composition" && prompt.style_description)
    next.style_description = importStyle(prompt.style_description, state.style_description);
  return next;
}

export function importIdeogramText(state: EditorState, text: string, mode: ImportMode) {
  return parseBoundedJson(text).andThen((value) => {
    const parsed = ideogramImportSchema.safeParse(value);
    return parsed.success
      ? ok(importPromptIntoState(state, parsed.data, mode))
      : err(editorErrors.runtime("Invalid Ideogram 4 prompt", { issues: parsed.error.issues }));
  });
}

export function previewIdeogram(state: EditorState): string {
  return toIdeogramV4PrettyJsonString(buildPrompt(state));
}
