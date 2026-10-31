import type { EditorRegion, EditorState } from "./state";

export type RegionEntry = { region: EditorRegion; depth: number };

// The outline and native prompt use the same parent-first traversal. Boxes are canvas-relative.
export function regionOutline(elements: EditorRegion[]): RegionEntry[] {
  const children = new Map<string | null, EditorRegion[]>();
  for (const region of elements) {
    const parent = region.parent_id ?? null;
    children.set(parent, [...(children.get(parent) ?? []), region]);
  }
  const entries: RegionEntry[] = [];
  const stack = (children.get(null) ?? []).map((region) => ({ region, depth: 0 })).reverse();
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    entries.push(entry);
    for (const region of [...(children.get(entry.region.id) ?? [])].reverse()) {
      stack.push({ region, depth: entry.depth + 1 });
    }
  }
  return entries;
}

export function regionSubtreeIds(elements: EditorRegion[], id: string): Set<string> {
  const ids = new Set([id]);
  for (const { region } of regionOutline(elements)) {
    if (region.parent_id != null && ids.has(region.parent_id)) ids.add(region.id);
  }
  return ids;
}

export function canParentRegion(elements: EditorRegion[], id: string, parentId: string | null): boolean {
  return (
    parentId === null ||
    (elements.some((region) => region.id === parentId) && !regionSubtreeIds(elements, id).has(parentId))
  );
}

// Slots refer to the original sibling list, including the moving subtree.
export function moveRegion(state: EditorState, id: string, parentId: string | null, slot: number): EditorState {
  const moving = state.elements.find((region) => region.id === id);
  if (!moving || !canParentRegion(state.elements, id, parentId)) return state;
  const siblings = state.elements.filter((region) => (region.parent_id ?? null) === parentId);
  const source = siblings.findIndex((region) => region.id === id);
  const remaining = siblings.filter((region) => region.id !== id);
  const target = Math.max(0, Math.min(remaining.length, source >= 0 && slot > source ? slot - 1 : slot));
  remaining.splice(target, 0, { ...moving, parent_id: parentId });
  const elements = state.elements.filter((region) => region.id !== id && (region.parent_id ?? null) !== parentId);
  return { ...state, elements: regionOutline([...elements, ...remaining]).map((entry) => entry.region) };
}

const colors = ["#77BCFA", "#8BD9B0", "#C7A5FA", "#F49CB6", "#F3BD7C", "#C5DB83", "#83D8DE"];

export function regionColor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return colors[hash % colors.length];
}

export function regionTitle(region: EditorRegion, index: number): string {
  return (
    (region.type === "text" ? region.text : region.desc).trim().split("\n")[0] ||
    `Untitled ${region.label ?? (region.type === "text" ? "text" : "object")} ${index + 1}`
  );
}

// Each copy keeps its subtree, follows its source among siblings and shifts as one block so nesting stays intact.
export function duplicateRegions(state: EditorState, ids: string[]): EditorState {
  const outline = regionOutline(state.elements);
  const renamed = new Map<string | null | undefined, string>();
  const copies = new Map<string, EditorRegion[]>();
  for (const { region } of outline) {
    if (!ids.includes(region.id) || renamed.has(region.id)) continue;
    const subtree = regionSubtreeIds(state.elements, region.id);
    const members = outline.map((entry) => entry.region).filter((item) => subtree.has(item.id));
    const boxes = members.flatMap((item) => (item.bbox ? [item.bbox] : []));
    const dy = Math.min(16, 1000 - Math.max(...boxes.map((box) => box[2])));
    const dx = Math.min(16, 1000 - Math.max(...boxes.map((box) => box[3])));
    copies.set(
      region.id,
      members.map((item) => {
        const id = `${item.type}-${crypto.randomUUID()}`;
        renamed.set(item.id, id);
        return {
          ...item,
          id,
          parent_id: renamed.get(item.parent_id) ?? item.parent_id,
          bbox: item.bbox && [item.bbox[0] + dy, item.bbox[1] + dx, item.bbox[2] + dy, item.bbox[3] + dx],
          color_palette: [...item.color_palette],
        };
      }),
    );
  }
  const first = copies.values().next().value?.[0];
  if (!first) return state;
  return {
    ...state,
    elements: regionOutline(state.elements.flatMap((region) => [region, ...(copies.get(region.id) ?? [])])).map(
      (entry) => entry.region,
    ),
    selected_region_id: renamed.get(state.selected_region_id) ?? first.id,
  };
}

export function removeRegions(state: EditorState, ids: string[]): EditorState {
  const removed = new Set(ids.flatMap((id) => [...regionSubtreeIds(state.elements, id)]));
  const elements = state.elements.filter((region) => !removed.has(region.id));
  return {
    ...state,
    elements,
    selected_region_id:
      state.selected_region_id && removed.has(state.selected_region_id) ? null : state.selected_region_id,
  };
}
