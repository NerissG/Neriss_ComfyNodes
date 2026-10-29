import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { comfyErrors, type AppError } from "@/errors";
import { comfyAppModuleSchema, comfyNodeDataSchema } from "@/comfy/schemas";
import type { ComfyAppModule, ComfyNodeData } from "@/comfy/types";

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

export function parseComfyNodeData(value: unknown): Result<ComfyNodeData, AppError> {
  const result = comfyNodeDataSchema.safeParse(value);
  if (!result.success) {
    return err(comfyErrors.runtime("Comfy node data is invalid", zodIssues(result.error), result.error));
  }

  return ok(result.data);
}
