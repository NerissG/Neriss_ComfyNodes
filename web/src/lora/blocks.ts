import { targetGroups, targetMultiplier } from "./state";

export type ModuleControl = { name: string; label: string; group: boolean };
export type StrengthBlock = { name: string; label: string; targets: string[]; controls: ModuleControl[] };
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

export function resetBlockMultipliers(
  overrides: Record<string, number>,
  blocks: StrengthBlock[],
): Record<string, number> {
  const names = new Set(blocks.flatMap((block) => [block.name, ...block.controls.map((control) => control.name)]));
  return Object.fromEntries(Object.entries(overrides).filter(([name]) => !names.has(name)));
}
