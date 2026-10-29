import { z } from "zod";
import { bboxSchema } from "@/layout/geometry";
import { textSchema } from "@/layout/limits";

export const IdeogramV4BboxSchema = z
  .tuple([
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
  ])
  .refine(([yMin, xMin, yMax, xMax]) => yMin <= yMax && xMin <= xMax, {
    message: "bbox must be ordered as [y_min, x_min, y_max, x_max].",
  });

export const IdeogramV4HexColorSchema = z.string().regex(/^#[0-9A-F]{6}$/);

export const IdeogramV4ObjectElementSchema = z
  .object({
    type: z.literal("obj"),
    bbox: IdeogramV4BboxSchema.optional(),
    desc: textSchema,
    color_palette: z.array(IdeogramV4HexColorSchema).max(5).optional(),
  })
  .strict();

export const IdeogramV4TextElementSchema = z
  .object({
    type: z.literal("text"),
    bbox: IdeogramV4BboxSchema.optional(),
    text: textSchema,
    desc: textSchema,
    color_palette: z.array(IdeogramV4HexColorSchema).max(5).optional(),
  })
  .strict();

export const IdeogramV4ElementSchema = z.discriminatedUnion("type", [
  IdeogramV4ObjectElementSchema,
  IdeogramV4TextElementSchema,
]);

export const IdeogramV4PhotoStyleSchema = z
  .object({
    aesthetics: textSchema,
    lighting: textSchema,
    medium: textSchema,
    photo: textSchema,
    color_palette: z.array(IdeogramV4HexColorSchema).max(16).optional(),
  })
  .strict();

export const IdeogramV4ArtStyleSchema = z
  .object({
    aesthetics: textSchema,
    lighting: textSchema,
    medium: textSchema,
    art_style: textSchema,
    color_palette: z.array(IdeogramV4HexColorSchema).max(16).optional(),
  })
  .strict();

export const IdeogramV4StyleDescriptionSchema = z.union([IdeogramV4PhotoStyleSchema, IdeogramV4ArtStyleSchema]);

export const IdeogramV4CompositionalDeconstructionSchema = z
  .object({
    background: z.string(),
    elements: z.array(IdeogramV4ElementSchema),
  })
  .strict();

export const IdeogramV4JsonPromptSchema = z
  .object({
    high_level_description: z.string().optional(),
    style_description: IdeogramV4StyleDescriptionSchema.optional(),
    compositional_deconstruction: IdeogramV4CompositionalDeconstructionSchema,
  })
  .strict();

export type IdeogramV4Bbox = z.infer<typeof IdeogramV4BboxSchema>;
export type IdeogramV4ObjectElement = z.infer<typeof IdeogramV4ObjectElementSchema>;
export type IdeogramV4TextElement = z.infer<typeof IdeogramV4TextElementSchema>;
export type IdeogramV4Element = z.infer<typeof IdeogramV4ElementSchema>;
export type IdeogramV4PhotoStyle = z.infer<typeof IdeogramV4PhotoStyleSchema>;
export type IdeogramV4ArtStyle = z.infer<typeof IdeogramV4ArtStyleSchema>;
export type IdeogramV4StyleDescription = z.infer<typeof IdeogramV4StyleDescriptionSchema>;
export type IdeogramV4CompositionalDeconstruction = z.infer<typeof IdeogramV4CompositionalDeconstructionSchema>;
export type IdeogramV4JsonPrompt = z.infer<typeof IdeogramV4JsonPromptSchema>;

const importBbox = bboxSchema.transform(([y0, x0, y1, x1]): IdeogramV4Bbox => [
  Math.round(y0),
  Math.round(x0),
  Math.round(y1),
  Math.round(x1),
]);
const importElements = z.discriminatedUnion("type", [
  IdeogramV4ObjectElementSchema.extend({ bbox: importBbox.optional() }),
  IdeogramV4TextElementSchema.extend({ bbox: importBbox.optional(), text: z.string().max(65_536).default("") }),
]);

export const ideogramImportSchema = z
  .object({
    high_level_description: z.string().max(65_536).optional(),
    style_description: IdeogramV4StyleDescriptionSchema.optional(),
    compositional_deconstruction: z
      .object({
        background: z.string().max(65_536).default(""),
        elements: z.array(importElements).max(2048),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Expected Ideogram prompt fields")
  .transform((value) => ({
    ...value,
    compositional_deconstruction: value.compositional_deconstruction ?? { background: "", elements: [] },
  }));

const bboxPrettyPattern = /"bbox": \[\n\s+(\d+),\n\s+(\d+),\n\s+(\d+),\n\s+(\d+)\n\s+\]/g;

function inlinePrettyBboxes(value: string): string {
  return value.replace(bboxPrettyPattern, '"bbox": [$1, $2, $3, $4]');
}

export function toIdeogramV4JsonString(value: IdeogramV4JsonPrompt): string {
  const parsed = IdeogramV4JsonPromptSchema.parse(value);
  return JSON.stringify(parsed);
}

export function toIdeogramV4PrettyJsonString(value: IdeogramV4JsonPrompt): string {
  const parsed = IdeogramV4JsonPromptSchema.parse(value);
  return inlinePrettyBboxes(JSON.stringify(parsed, null, 4));
}
