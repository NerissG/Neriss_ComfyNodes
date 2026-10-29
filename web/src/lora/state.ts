import { err, ok } from "neverthrow";
import { z } from "zod";
import { parseBoundedJson } from "@/shared/json";
import { editorErrors } from "@/errors";

export const LORA_NODE_ID = "Neriss_LoraBlockStrengthEditor";
export const strengthSchema = z.number().min(-20).max(20);
const nameSchema = z.string().min(1).max(2048);
export const strengthStateSchema = z.object({
  version: z.literal(1),
  lora_name: z.string().max(2048),
  overrides: z.record(nameSchema, strengthSchema).refine((value) => Object.keys(value).length <= 30_000),
});
export type StrengthState = z.infer<typeof strengthStateSchema>;
export const manifestSchema = z.object({
  lora_name: nameSchema,
  targets: z.array(nameSchema).max(30_000),
  unsupported: z.array(nameSchema).max(30_000),
});
export type LoraManifest = z.infer<typeof manifestSchema>;

export function emptyStrengthState(loraName = ""): StrengthState {
  return { version: 1, lora_name: loraName, overrides: {} };
}

export function parseStrengthState(value: unknown) {
  if (typeof value !== "string") return err(editorErrors.runtime("Missing LoRA strength state"));
  return parseBoundedJson(value).andThen((json) => {
    const parsed = strengthStateSchema.safeParse(json);
    return parsed.success ? ok(parsed.data) : err(editorErrors.runtime("Invalid or unsupported LoRA strength state"));
  });
}

export function targetGroups(target: string): string[] {
  const ends = new Set<number>();
  for (const match of target.matchAll(/\./g)) ends.add(match.index);
  for (const match of target.matchAll(/_\d+(?=_|$)/g)) ends.add(match.index + match[0].length);
  return [...ends]
    .filter((end) => end > 0 && end < target.length)
    .sort((a, b) => a - b)
    .map((end) => target.slice(0, end));
}

export function targetMultiplier(target: string, overrides: Record<string, number>): number {
  for (const name of [target, ...targetGroups(target).reverse()]) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
  }
  return 1;
}
