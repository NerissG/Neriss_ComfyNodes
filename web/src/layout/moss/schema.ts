import { z } from "zod";
import { coordinateSchema, hexColorSchema, type Bbox } from "@/layout/geometry";
import { MAX_REGIONS, MAX_TAGS, textSchema } from "@/layout/limits";

const mossBboxSchema = z
  .tuple([coordinateSchema, coordinateSchema, coordinateSchema, coordinateSchema])
  .refine(([y0, x0, y1, x1]) => y0 <= y1 && x0 <= x1, "Expected [y_min, x_min, y_max, x_max]");
const mossItemSchema = z
  .object({
    label: textSchema.trim().min(1),
    caption: textSchema,
    bbox: mossBboxSchema,
    text: textSchema.optional(),
    palette: z.array(hexColorSchema).max(5).optional(),
  })
  .strict()
  .refine((item) => item.label !== "text" || item.text !== undefined, {
    message: "Text regions require literal text",
    path: ["text"],
  });
const mossPromptContentSchema = z
  .object({
    summary: z
      .object({
        meta: z.array(textSchema).max(MAX_TAGS).default([]),
        canvas: z.literal("single").default("single"),
        caption: textSchema,
      })
      .strict(),
    items: z.array(mossItemSchema).max(MAX_REGIONS),
  })
  .strict();

export const mossPromptSchema = mossPromptContentSchema.extend({
  bbox_coord_space: z.literal("abs_centralized"),
  bbox_format: z.literal("yxyx"),
});
export type MossPrompt = z.infer<typeof mossPromptSchema>;

const normalizedCoordinate = z.number().min(0).max(1000);
const normalizedMossBboxSchema = z
  .tuple([normalizedCoordinate, normalizedCoordinate, normalizedCoordinate, normalizedCoordinate])
  .refine(([x0, y0, x1, y1]) => x0 <= x1 && y0 <= y1, "Expected [x_min, y_min, x_max, y_max]")
  .transform(([x0, y0, x1, y1]): Bbox => [y0, x0, y1, x1]);

const normalizedMossPromptSchema = mossPromptContentSchema.extend({
  bbox_coord_space: z.undefined().optional(),
  items: z.array(mossItemSchema.safeExtend({ bbox: normalizedMossBboxSchema })).max(MAX_REGIONS),
});

export const mossImportSchema = z.discriminatedUnion("bbox_coord_space", [
  mossPromptSchema,
  normalizedMossPromptSchema,
]);
