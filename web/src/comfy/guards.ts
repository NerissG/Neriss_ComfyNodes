import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { comfyErrors, type AppError } from "@/errors";
import { comfyAppModuleSchema, comfyNodeDataSchema, comfyNodeSchema } from "@/comfy/schemas";
import type { ComfyAppModule, ComfyNode, ComfyNodeData } from "@/comfy/types";

function zodIssues(error: z.ZodError): Record<string, unknown> {
  return { issues: error.issues };
}

export function parseComfyAppModule(value: unknown): Result<ComfyAppModule, AppError> {
  const result = comfyAppModuleSchema.safeParse(value);
  if (!result.success) {
    return err(comfyErrors.runtime("Comfy app module is invalid", zodIssues(result.error), result.error));
  }

  return ok(result.data);
}

export function parseComfyNode(value: unknown): Result<ComfyNode, AppError> {
  const result = comfyNodeSchema.safeParse(value);
  if (!result.success) {
    return err(comfyErrors.runtime("Comfy node is invalid", zodIssues(result.error), result.error));
  }

  if (!isComfyNode(value)) {
    return err(comfyErrors.runtime("Comfy node is invalid"));
  }

  return ok(value);
}

export function isComfyNode(value: unknown): value is ComfyNode {
  return comfyNodeSchema.safeParse(value).success;
}

export function parseComfyNodeData(value: unknown): Result<ComfyNodeData, AppError> {
  const result = comfyNodeDataSchema.safeParse(value);
  if (!result.success) {
    return err(comfyErrors.runtime("Comfy node data is invalid", zodIssues(result.error), result.error));
  }

  return ok(result.data);
}
