import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { editorErrors, type EditorError } from "@/errors";
import { strengthSchema, targetGroups, targetMultiplier } from "./state";

export type ModuleControl = { name: string; label: string; group: boolean };
export type StrengthBlock = {
  name: string;
  label: string;
  short: string;
  targets: string[];
  controls: ModuleControl[];
};
export type BlockFamily = { name: string; label: string; blocks: StrengthBlock[] };
const order = new Intl.Collator(undefined, { numeric: true });

function shortPath(name: string): string {
  return name.replace(/^(?:lora_(?:unet|te\d*|transformer)_|diffusion_model\.|text_encoders\.)/, "");
}

function familyLabel(name: string): string {
  const label = shortPath(name)
    .replace(/[._]+/g, " ")
    .replace(/\bllm\b/gi, "LLM")
    .replace(/ blocks$/i, "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function buildBlockFamilies(targets: string[]): BlockFamily[] {
  const families = new Map<string, BlockFamily>();
  const blocks = new Map<string, StrengthBlock>();
  for (const target of new Set(targets)) {
    const indexed = [...targetGroups(target), target].find((name) => /[._]\d+$/.test(name));
    const match = indexed?.match(/[._](\d+)$/);
    const familyName = indexed && match ? indexed.slice(0, match.index) : "";
    const blockName = indexed ?? target;
    let family = families.get(familyName);
    if (!family) {
      family = { name: familyName, label: familyName ? familyLabel(familyName) : "Other", blocks: [] };
      families.set(familyName, family);
    }
    let block = blocks.get(blockName);
    if (!block) {
      block = {
        name: blockName,
        label: match ? `Block ${match[1].padStart(2, "0")}` : shortPath(target),
        short: match ? match[1].padStart(2, "0") : shortPath(target),
        targets: [],
        controls: [],
      };
      blocks.set(blockName, block);
      family.blocks.push(block);
    }
    block.targets.push(target);
  }
  for (const block of blocks.values()) {
    const names = new Set(block.targets.flatMap((target) => [...targetGroups(target), target]));
    const leaves = new Set(block.targets);
    block.controls = [...names]
      .filter((name) => name !== block.name && (name.startsWith(`${block.name}.`) || name.startsWith(`${block.name}_`)))
      .sort(order.compare)
      .map((name) => ({ name, label: name.slice(block.name.length + 1), group: !leaves.has(name) }));
    block.targets.sort(order.compare);
  }
  return [...families.values()]
    .sort((a, b) => (a.name === "" ? 1 : b.name === "" ? -1 : order.compare(a.name, b.name)))
    .map((family) => ({ ...family, blocks: family.blocks.sort((a, b) => order.compare(a.name, b.name)) }));
}

export function blockChanged(block: StrengthBlock, overrides: Record<string, number>): boolean {
  return (
    targetMultiplier(block.name, overrides) !== 1 ||
    [block.name, ...block.controls.map((control) => control.name)].some((name) => Object.hasOwn(overrides, name))
  );
}

export function filterBlockFamilies(
  families: BlockFamily[],
  query: string,
  changedOnly: boolean,
  overrides: Record<string, number>,
): BlockFamily[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return families.flatMap((family) => {
    const blocks = family.blocks.filter((block) => {
      if (changedOnly && !blockChanged(block, overrides)) return false;
      const text =
        `${family.name} ${family.label} ${block.name} ${block.label} ${block.targets.join(" ")}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
    return blocks.length ? [{ ...family, blocks }] : [];
  });
}

export function setBlockMultipliers(
  overrides: Record<string, number>,
  names: Iterable<string>,
  value: number,
): Record<string, number> {
  return { ...overrides, ...Object.fromEntries([...names].map((name) => [name, value])) };
}

function within(name: string, names: Set<string>): boolean {
  return names.has(name) || targetGroups(name).some((group) => names.has(group));
}

/** Removes overrides for `names` and every module nested under them. */
export function clearOverrides(overrides: Record<string, number>, names: Iterable<string>): Record<string, number> {
  const scope = new Set(names);
  return Object.fromEntries(Object.entries(overrides).filter(([name]) => !within(name, scope)));
}

export function hasOverridesWithin(overrides: Record<string, number>, names: Iterable<string>): boolean {
  const scope = new Set(names);
  return Object.keys(overrides).some((name) => within(name, scope));
}

export function clampStrength(value: number): number {
  return Math.max(-20, Math.min(20, Number(value.toFixed(4))));
}

/** The rule each chart bar edits: the block itself, or one module of it when a module lens is active. */
export type ChartTarget = { block: StrengthBlock; name: string };

export function familyTargets(family: BlockFamily, lens: string): ChartTarget[] {
  return family.blocks.flatMap((block) => {
    if (!lens) return [{ block, name: block.name }];
    const control = block.controls.find((entry) => entry.label === lens);
    return control ? [{ block, name: control.name }] : [];
  });
}

export function familyModules(family: BlockFamily): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const block of family.blocks) {
    for (const control of block.controls) counts.set(control.label, (counts.get(control.label) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => order.compare(a, b)).map(([label, count]) => ({ label, count }));
}

/** Explicit overrides for names whose current multiplier differs from `values`. */
export function weightChanges(
  names: string[],
  overrides: Record<string, number>,
  values: number[],
): Record<string, number> {
  return Object.fromEntries(
    names.flatMap((name, index) =>
      targetMultiplier(name, overrides) === values[index] ? [] : [[name, values[index]]],
    ),
  );
}

export function formatWeights(values: number[]): string {
  return values.map((value) => String(value)).join(",");
}

export function parseWeights(text: string, count: number): Result<number[], EditorError> {
  const values = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  const parsed = z.array(strengthSchema).length(count).safeParse(values);
  return parsed.success
    ? ok(parsed.data)
    : err(editorErrors.runtime(`Enter ${count} comma-separated values from -20 to 20`));
}

export function chartRange(values: number[]): { lo: number; hi: number } {
  return { lo: Math.min(0, ...values), hi: Math.max(2, ...values) };
}

export function hasClipTargets(targets: string[]): boolean {
  return targets.some((target) => /^(?:lora_te\d*_|lora_prior_te_|text_encoders?\.)/.test(target));
}
