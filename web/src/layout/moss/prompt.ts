import { err, ok, type Result as PromptResult } from "neverthrow";
import { parseBoundedJson } from "@/shared/json";
import { editorErrors, type AppError } from "@/errors";
import { fromCentralized, toCentralized } from "@/layout/geometry";
import { createRegion, hasRegionBbox, type EditorState } from "@/layout/state";
import { regionOutline, regionTitle } from "@/layout/regions";
import { mossImportSchema, type MossPrompt } from "./schema";

export function buildMossPrompt(state: EditorState): PromptResult<MossPrompt, AppError> {
  const regions = regionOutline(state.elements).map(({ region }) => region);
  const unplaced = regions.find((region) => region.bbox === null);
  if (unplaced)
    return err(
      editorErrors.runtime(
        `Draw a bounding box for "${regionTitle(unplaced, regions.indexOf(unplaced))}" before exporting a MOSS prompt.`,
      ),
    );
  return ok({
    summary: { meta: state.moss_meta, canvas: "single", caption: state.high_level_description },
    items: regions.filter(hasRegionBbox).map((region) => {
      const bbox = toCentralized(region.bbox, state.width, state.height);
      const label = region.label ?? (region.type === "text" ? "text" : "object");
      return {
        label,
        caption: region.desc,
        ...(label === "text" ? { text: region.text } : {}),
        ...(region.color_palette.length ? { palette: region.color_palette } : {}),
        bbox,
      };
    }),
    bbox_coord_space: "abs_centralized",
    bbox_format: "yxyx",
  });
}

export function importMossText(state: EditorState, text: string) {
  return parseBoundedJson(text).andThen((value) => {
    const parsed = mossImportSchema.safeParse(value);
    if (!parsed.success) {
      const explanation = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "prompt"}: ${issue.message}`)
        .join("; ");
      return err(editorErrors.runtime(`Invalid MOSS layout prompt: ${explanation}`, { issues: parsed.error.issues }));
    }
    const prompt = parsed.data;
    const elements = prompt.items.map((item) => {
      const bbox =
        prompt.bbox_coord_space === "abs_centralized"
          ? fromCentralized(item.bbox, state.width, state.height)
          : item.bbox;
      return {
        ...createRegion(item.label === "text" ? "text" : "obj", bbox),
        desc: item.caption,
        label: item.label,
        text: item.text ?? "",
        color_palette: item.palette ?? [],
      };
    });
    return ok({
      ...state,
      high_level_description: prompt.summary.caption,
      moss_meta: prompt.summary.meta,
      elements,
      selected_region_id: null,
    });
  });
}

export function previewMoss(state: EditorState): PromptResult<string, AppError> {
  return buildMossPrompt(state).map((prompt) =>
    JSON.stringify(prompt, null, 4).replace(
      /"bbox": \[\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\]/g,
      '"bbox": [$1, $2, $3, $4]',
    ),
  );
}
