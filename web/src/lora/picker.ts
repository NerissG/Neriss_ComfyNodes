import { z } from "zod";
import { findWidget } from "@/comfy/nodes";
import type { ComfyNode } from "@/comfy/types";

export type LoraChoice = { name: string; label: string; folder: string; search: string };

function searchText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\\/_.-]+/g, " ");
}

export function prepareLoraChoices(names: string[]): LoraChoice[] {
  return names.map((name) => {
    const path = name.replace(/\\/g, "/");
    const separator = path.lastIndexOf("/");
    return {
      name,
      label: path.slice(separator + 1).replace(/\.safetensors$/i, ""),
      folder: separator < 0 ? "" : path.slice(0, separator),
      search: searchText(path),
    };
  });
}

export function filterLoraChoices(choices: LoraChoice[], query: string): LoraChoice[] {
  const terms = searchText(query).trim().split(/\s+/).filter(Boolean);
  return terms.length ? choices.filter((choice) => terms.every((term) => choice.search.includes(term))) : choices;
}

const loraNamesSchema = z.array(z.string().min(1).max(2048));

/** The node's LoRA options, keeping its current value first even when it is no longer listed. */
export function loraChoices(node: ComfyNode): string[] {
  const widget = findWidget(node, "lora_name");
  const parsed = loraNamesSchema.safeParse(widget?.options?.values ?? []);
  const current = typeof widget?.value === "string" && widget.value ? [widget.value] : [];
  return [...new Set([...current, ...(parsed.success ? parsed.data : [])])];
}
