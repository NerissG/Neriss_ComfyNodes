import { z } from "zod";
import type { ComfyApp, ComfyAppModule, ComfyNodeData } from "@/comfy/types";

const registerExtensionSchema = z.custom<ComfyApp["registerExtension"]>((value) => typeof value === "function");

const comfyAppSchema = z.object({
  registerExtension: registerExtensionSchema,
}) satisfies z.ZodType<ComfyApp>;

export const comfyAppModuleSchema = z.object({
  app: comfyAppSchema,
}) satisfies z.ZodType<ComfyAppModule>;

export const comfyNodeDataSchema = z.object({
  name: z.string(),
}) satisfies z.ZodType<ComfyNodeData>;
