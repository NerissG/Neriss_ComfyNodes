import { z } from "zod";
import type { ComfyApp, ComfyAppModule, ComfyInputSlot, ComfyNode, ComfyNodeData, ComfyWidget } from "@/comfy/types";

const registerExtensionSchema = z.custom<ComfyApp["registerExtension"]>((value) => typeof value === "function");
const addWidgetSchema = z.custom<ComfyNode["addWidget"]>((value) => typeof value === "function");
const removeInputSchema = z.custom<ComfyNode["removeInput"]>((value) => typeof value === "function");
const computeNodeSizeSchema = z.custom<ComfyNode["computeSize"]>((value) => typeof value === "function");
const setSizeSchema = z.custom<ComfyNode["setSize"]>((value) => typeof value === "function");
const setDirtyCanvasSchema = z.custom<NonNullable<ComfyNode["setDirtyCanvas"]>>((value) => typeof value === "function");

export const comfyInputSlotSchema = z.object({
  name: z.string(),
}) satisfies z.ZodType<ComfyInputSlot>;

export const comfyWidgetSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  hidden: z.boolean().optional(),
  value: z.unknown().optional(),
  options: z
    .object({
      values: z.array(z.string()).optional(),
    })
    .optional(),
  callback: z.custom<ComfyWidget["callback"]>((value) => typeof value === "function").optional(),
  computeSize: z.custom<ComfyWidget["computeSize"]>((value) => typeof value === "function").optional(),
  nerissResolutionCallbackAttached: z.boolean().optional(),
}) satisfies z.ZodType<ComfyWidget>;

export const comfyAppSchema = z.object({
  registerExtension: registerExtensionSchema,
}) satisfies z.ZodType<ComfyApp>;

export const comfyAppModuleSchema = z.object({
  app: comfyAppSchema,
}) satisfies z.ZodType<ComfyAppModule>;

export const comfyNodeSchema = z.object({
  id: z.union([z.number(), z.string()]),
  comfyClass: z.string().optional(),
  type: z.string().optional(),
  widgets: z.array(comfyWidgetSchema).optional(),
  inputs: z.array(comfyInputSlotSchema).optional(),
  addWidget: addWidgetSchema,
  removeInput: removeInputSchema.optional(),
  computeSize: computeNodeSizeSchema.optional(),
  setSize: setSizeSchema.optional(),
  setDirtyCanvas: setDirtyCanvasSchema.optional(),
}) satisfies z.ZodType<ComfyNode>;

export const comfyNodeDataSchema = z.object({
  name: z.string(),
}) satisfies z.ZodType<ComfyNodeData>;
