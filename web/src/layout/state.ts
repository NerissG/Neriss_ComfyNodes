import { err, ok, type Result as NeverthrowResult } from "neverthrow";
import { z } from "zod";
import { editorErrors, type AppError } from "@/errors";
import { calculateResolution } from "@/resolution/sizing";
import { bboxSchema, clampBbox, hexColorSchema, type Bbox } from "./geometry";
import { parseBoundedJson } from "@/shared/json";
import { MAX_REGIONS, MAX_TAGS, textSchema } from "./limits";

export type EditorModel = "ideogram" | "moss";
export type RegionTool = "obj" | "text";

const editorStyleSchema = z.object({
  mode: z.enum(["art", "photo"]).default("art"),
  aesthetics: textSchema.default("premium, clean, coherent composition"),
  lighting: textSchema.default("soft studio lighting with readable contrast"),
  medium: textSchema.default("graphic_design"),
  art_style: textSchema.default("modern editorial layout"),
  photo: textSchema.default("photograph"),
  color_palette: z.array(hexColorSchema).max(16).default([]),
});

const editorRegionSchema = z.object({
  id: textSchema.min(1),
  parent_id: textSchema.min(1).nullable().optional(),
  type: z.enum(["obj", "text"]),
  label: textSchema.trim().min(1).optional(),
  bbox: bboxSchema.nullable().default(null),
  desc: textSchema.default(""),
  text: textSchema.default(""),
  color_palette: z.array(hexColorSchema).max(5).default([]),
});

const editorElementsSchema = z
  .array(editorRegionSchema)
  .max(MAX_REGIONS)
  .superRefine((elements, context) => {
    const byId = new Map(elements.map((region) => [region.id, region]));
    for (const [index, region] of elements.entries()) {
      if (elements.findIndex((item) => item.id === region.id) !== index) {
        context.addIssue({ code: "custom", path: [index, "id"], message: "Region IDs must be unique" });
      }
      const seen = new Set([region.id]);
      let parentId = region.parent_id;
      while (parentId != null) {
        const parent = byId.get(parentId);
        if (!parent || seen.has(parentId)) {
          context.addIssue({
            code: "custom",
            path: [index, "parent_id"],
            message: "Region parents must exist and cannot form a cycle",
          });
          break;
        }
        seen.add(parentId);
        parentId = parent.parent_id;
      }
    }
  });

const editorCanvasSchema = z.object({
  width: z.number().int().positive().default(1024),
  height: z.number().int().positive().default(1024),
  megapixels: z.number().positive().default(1),
  side_step: z.number().int().positive().default(64),
  size_mode: z.enum(["megapixels", "squared"]).default("megapixels"),
  target_locked: z.boolean().default(false),
});

const editorStateSchema = z.object({
  version: z.literal(1).default(1),
  ...editorCanvasSchema.shape,
  high_level_description: textSchema.default(""),
  background: textSchema.default("Dark gray design canvas with a subtle grid."),
  style_description: editorStyleSchema.prefault({}),
  moss_meta: z.array(textSchema).max(MAX_TAGS).default([]),
  elements: editorElementsSchema.default([]),
  selected_region_id: textSchema.nullable().default(null),
  selected_tool: z.enum(["obj", "text"]).default("obj"),
  reference_image_path: textSchema.nullable().default(null),
  reference_image_name: textSchema.nullable().default(null),
  reference_image_fit: z.enum(["stretch", "contain"]).default("stretch"),
});

export type EditorState = z.infer<typeof editorStateSchema>;
export type EditorStyle = z.infer<typeof editorStyleSchema>;
export type EditorRegion = z.infer<typeof editorRegionSchema>;
export type PlacedRegion = EditorRegion & { bbox: Bbox };

export function hasRegionBbox(region: EditorRegion): region is PlacedRegion {
  return region.bbox !== null;
}
const presetPartsSchema = z
  .strictObject({
    elements: editorElementsSchema.optional(),
    high_level_description: textSchema.optional(),
    moss_meta: z.array(textSchema).max(MAX_TAGS).optional(),
    style_description: editorStyleSchema.optional(),
    background: textSchema.optional(),
    canvas: editorCanvasSchema.strict().optional(),
  })
  .refine((parts) => Object.keys(parts).length > 0, "Presets need at least one part");
export const layoutPresetSchema = z.object({
  id: textSchema.min(1),
  name: textSchema.trim().min(1),
  parts: presetPartsSchema,
});
export type LayoutPreset = z.infer<typeof layoutPresetSchema>;
export type PresetParts = LayoutPreset["parts"];
export type PresetPart = keyof PresetParts;
export type ApplyMode = "replace" | "append";

export function createInitialState(): EditorState {
  return editorStateSchema.parse({});
}

export function parseEditorState(value: unknown): NeverthrowResult<EditorState, AppError> {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim()))
    return ok(createInitialState());
  if (typeof value !== "string") return err(editorErrors.runtime("Saved editor state must be JSON text"));
  return parseBoundedJson(value).andThen((parsed) => {
    const result = editorStateSchema.safeParse(parsed);
    return result.success
      ? ok(result.data)
      : err(editorErrors.runtime("Saved editor state is invalid", { issues: result.error.issues }, result.error));
  });
}

export function stringifyEditorState(state: EditorState): string {
  return JSON.stringify(editorStateSchema.parse(state));
}

/** Identifies the saved layout content, ignoring the current selection. */
export function layoutDocumentKey(state: EditorState): string {
  return JSON.stringify({ ...state, selected_region_id: null, selected_tool: "obj" });
}

export function encodeEditorState(state: EditorState): NeverthrowResult<string, AppError> {
  const parsed = editorStateSchema.safeParse(state);
  if (!parsed.success) {
    return err(editorErrors.runtime(parsed.error.issues.map((issue) => issue.message).join(" ")));
  }
  const text = JSON.stringify(parsed.data);
  if (text.length > 2 * 1024 * 1024 || new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) {
    return err(editorErrors.runtime("Editor state exceeds the 2 MiB limit"));
  }
  return ok(text);
}

export function capturePreset(state: EditorState, parts: PresetPart[]): PresetParts {
  return structuredClone({
    ...(parts.includes("elements") ? { elements: state.elements } : {}),
    ...(parts.includes("high_level_description") ? { high_level_description: state.high_level_description } : {}),
    ...(parts.includes("moss_meta") ? { moss_meta: state.moss_meta } : {}),
    ...(parts.includes("style_description") ? { style_description: state.style_description } : {}),
    ...(parts.includes("background") ? { background: state.background } : {}),
    ...(parts.includes("canvas")
      ? {
          canvas: {
            width: state.width,
            height: state.height,
            megapixels: state.megapixels,
            side_step: state.side_step,
            size_mode: state.size_mode,
            target_locked: state.target_locked,
          },
        }
      : {}),
  });
}

/** Preset regions get fresh IDs so repeated appends never collide with the canvas or each other. */
function renewRegionIds(elements: EditorRegion[]): EditorRegion[] {
  const ids = new Map(elements.map((region) => [region.id, `${region.type}-${crypto.randomUUID()}`]));
  return structuredClone(elements).map((region) => ({
    ...region,
    id: ids.get(region.id) ?? region.id,
    parent_id: region.parent_id == null ? region.parent_id : ids.get(region.parent_id),
  }));
}

export function applyPreset(
  state: EditorState,
  preset: PresetParts,
  parts: PresetPart[],
  mode: ApplyMode,
): NeverthrowResult<EditorState, AppError> {
  const next = { ...state };
  if (preset.elements && parts.includes("elements")) {
    const elements = renewRegionIds(preset.elements);
    next.elements = mode === "append" ? [...state.elements, ...elements] : elements;
    if (next.elements.length > MAX_REGIONS)
      return err(editorErrors.runtime(`Layouts are limited to ${MAX_REGIONS} regions`));
    if (mode === "replace") next.selected_region_id = null;
  }
  if (preset.high_level_description !== undefined && parts.includes("high_level_description"))
    next.high_level_description = preset.high_level_description;
  if (preset.moss_meta && parts.includes("moss_meta")) next.moss_meta = [...preset.moss_meta];
  if (preset.style_description && parts.includes("style_description"))
    next.style_description = structuredClone(preset.style_description);
  if (preset.background !== undefined && parts.includes("background")) next.background = preset.background;
  // Region boxes are canvas-relative, so they keep their placement whether or not the canvas is applied.
  return ok(preset.canvas && parts.includes("canvas") ? { ...next, ...preset.canvas } : next);
}

export function createRegion(type: RegionTool, bbox: Bbox | null = null): EditorRegion {
  return {
    id: `${type}-${crypto.randomUUID()}`,
    type,
    bbox: bbox === null ? null : clampBbox(bbox),
    desc: "",
    text: "",
    color_palette: [],
  };
}

export function matchImageDimensions(state: EditorState, width: number, height: number): EditorState {
  // Preserve the exact image ratio; independently snapping sides introduces letterboxing.
  return { ...state, width, height, megapixels: (width * height) / 1_000_000 };
}

export function setAspectRatio(state: EditorState, ratioWidth: number, ratioHeight: number): EditorState {
  return { ...state, ...calculateResolution(ratioWidth, ratioHeight, state.megapixels * 1_000_000, state.side_step) };
}

export function swapOrientation(state: EditorState): EditorState {
  return { ...state, width: state.height, height: state.width };
}
