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

const editorStateSchema = z.object({
  version: z.literal(1).default(1),
  width: z.number().int().positive().default(1024),
  height: z.number().int().positive().default(1024),
  megapixels: z.number().positive().default(1),
  side_step: z.number().int().positive().default(64),
  size_mode: z.enum(["megapixels", "squared"]).default("megapixels"),
  target_locked: z.boolean().default(false),
  high_level_description: textSchema.default(""),
  background: textSchema.default("Dark gray design canvas with a subtle grid."),
  style_description: editorStyleSchema.prefault({}),
  moss_meta: z.array(textSchema).max(MAX_TAGS).default([]),
  elements: z
    .array(editorRegionSchema)
    .max(MAX_REGIONS)
    .default([])
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
    }),
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
export const stylePresetSchema = z.object({
  id: textSchema.min(1),
  name: textSchema.trim().min(1),
  style: editorStyleSchema,
});
export type StylePreset = z.infer<typeof stylePresetSchema>;

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

export function cloneStyle(style: EditorStyle): EditorStyle {
  return { ...style, color_palette: [...style.color_palette] };
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
