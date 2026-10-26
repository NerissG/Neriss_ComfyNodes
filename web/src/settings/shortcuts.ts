import { z } from "zod";
import type { EditorModel } from "@/editor/state";

const modifierSchema = z.enum(["Mod", "Control", "Meta", "Alt", "Shift"]);
export type Modifier = z.infer<typeof modifierSchema>;
const namedKeys = [
  "backspace",
  "delete",
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
  "home",
  "end",
  "pageup",
  "pagedown",
];

export function isShortcutKey(key: string): boolean {
  return (
    (/^[^\p{C}\p{Z}]$/u.test(key) && key === key.toLowerCase()) ||
    namedKeys.includes(key) ||
    /^f([1-9]|1[0-2])$/.test(key)
  );
}

export const bindingSchema = z.strictObject({
  key: z.string().refine(isShortcutKey, "Use a letter, number, punctuation, navigation or function key."),
  modifiers: z
    .array(modifierSchema)
    .max(4)
    .refine(
      (items) =>
        new Set(items).size === items.length &&
        !(items.includes("Mod") && (items.includes("Control") || items.includes("Meta"))),
      "Use unique modifiers; do not combine Ctrl/Cmd with explicit Control or Meta.",
    ),
});
export type KeyBinding = z.infer<typeof bindingSchema>;

export const commandIdSchema = z.enum([
  "tool.select",
  "tool.object",
  "tool.character",
  "tool.text",
  "tool.pan",
  "history.undo",
  "history.redo",
  "selection.delete",
  "view.focus",
  "view.fitCanvas",
  "view.zoomSelection",
  "view.toggleSidebar",
  "panel.regions",
  "panel.scene",
  "panel.canvas",
  "canvas.left",
  "canvas.right",
  "canvas.up",
  "canvas.down",
  "canvas.leftFast",
  "canvas.rightFast",
  "canvas.upFast",
  "canvas.downFast",
]);
export type CommandId = z.infer<typeof commandIdSchema>;
export type ShortcutOverrides = Partial<Record<CommandId, KeyBinding[]>>;
export type ShortcutCommand = {
  id: CommandId;
  label: string;
  category: string;
  scope: "editor" | "canvas";
  defaults: KeyBinding[];
  repeat?: boolean;
  model?: EditorModel;
};

function binding(key: string, ...modifiers: Modifier[]): KeyBinding {
  return { key, modifiers };
}

export const shortcutCommands: ShortcutCommand[] = [
  { id: "tool.select", label: "Select tool", category: "Tools", scope: "editor", defaults: [binding("v")] },
  { id: "tool.pan", label: "Pan tool", category: "Tools", scope: "editor", defaults: [binding("h")] },
  { id: "tool.object", label: "Object tool", category: "Tools", scope: "editor", defaults: [binding("o")] },
  {
    id: "tool.character",
    label: "Character tool",
    category: "Tools",
    scope: "editor",
    defaults: [binding("c")],
    model: "moss",
  },
  { id: "tool.text", label: "Text tool", category: "Tools", scope: "editor", defaults: [binding("t")] },
  {
    id: "history.undo",
    label: "Undo",
    category: "History & selection",
    scope: "editor",
    defaults: [binding("z", "Mod")],
  },
  {
    id: "history.redo",
    label: "Redo",
    category: "History & selection",
    scope: "editor",
    defaults: [binding("z", "Mod", "Shift"), binding("y", "Mod")],
  },
  {
    id: "selection.delete",
    label: "Delete regions",
    category: "History & selection",
    scope: "editor",
    defaults: [binding("delete"), binding("backspace")],
  },
  {
    id: "view.focus",
    label: "Focus selected region",
    category: "View & panels",
    scope: "editor",
    defaults: [binding("f")],
  },
  { id: "view.fitCanvas", label: "Fit canvas", category: "View & panels", scope: "editor", defaults: [binding("0")] },
  {
    id: "view.zoomSelection",
    label: "Zoom to selection",
    category: "View & panels",
    scope: "editor",
    defaults: [binding("1")],
  },
  {
    id: "view.toggleSidebar",
    label: "Toggle sidebar",
    category: "View & panels",
    scope: "editor",
    defaults: [binding("\\")],
  },
  {
    id: "panel.regions",
    label: "Regions panel",
    category: "View & panels",
    scope: "editor",
    defaults: [binding("1", "Alt")],
  },
  {
    id: "panel.scene",
    label: "Scene & style panel",
    category: "View & panels",
    scope: "editor",
    defaults: [binding("2", "Alt")],
  },
  {
    id: "panel.canvas",
    label: "Canvas panel",
    category: "View & panels",
    scope: "editor",
    defaults: [binding("3", "Alt")],
  },
  ...(
    [
      ["left", "canvas.left", "canvas.leftFast"],
      ["right", "canvas.right", "canvas.rightFast"],
      ["up", "canvas.up", "canvas.upFast"],
      ["down", "canvas.down", "canvas.downFast"],
    ] satisfies [string, CommandId, CommandId][]
  ).flatMap(([direction, normal, fast]): ShortcutCommand[] => [
    {
      id: normal,
      label: `Move ${direction} (1 px)`,
      category: "Canvas movement",
      scope: "canvas",
      repeat: true,
      defaults: [binding(`arrow${direction}`)],
    },
    {
      id: fast,
      label: `Move ${direction} (10 px)`,
      category: "Canvas movement",
      scope: "canvas",
      repeat: true,
      defaults: [binding(`arrow${direction}`, "Shift")],
    },
  ]),
];

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

function signature(value: KeyBinding, mac: boolean): string {
  const modifiers = new Set(
    value.modifiers.map((modifier) => (modifier === "Mod" ? (mac ? "Meta" : "Control") : modifier)),
  );
  return `${[...modifiers].sort().join("+")}:${value.key}`;
}

export function reservedBinding(value: KeyBinding): string | null {
  if (!isShortcutKey(value.key)) return "Escape, Tab, Enter, Space and modifier-only keys are reserved.";
  const primary = value.modifiers.some(
    (modifier) => modifier === "Mod" || modifier === "Control" || modifier === "Meta",
  );
  if (
    (primary && ["a", "c", "v", "x", "w", "t", "n", "r", "l", "q"].includes(value.key)) ||
    ["f1", "f5", "f6", "f11", "f12"].includes(value.key) ||
    (value.modifiers.includes("Alt") && ["arrowleft", "arrowright", "f4"].includes(value.key))
  ) {
    return "This shortcut is reserved for native editing, the browser or the operating system.";
  }
  return null;
}

export function commandBindings(id: CommandId, overrides: ShortcutOverrides): KeyBinding[] {
  return overrides[id] ?? shortcutCommands.find((command) => command.id === id)?.defaults ?? [];
}

export function shortcutIssues(overrides: ShortcutOverrides): string[] {
  const issues = new Set<string>();
  for (const mac of [false, true]) {
    const occupied = new Map<string, ShortcutCommand>();
    for (const command of shortcutCommands) {
      for (const value of commandBindings(command.id, overrides)) {
        const reserved = reservedBinding(value);
        if (reserved) issues.add(`${command.label}: ${reserved}`);
        const key = signature(value, mac);
        const previous = occupied.get(key);
        if (previous) issues.add(`${command.label} conflicts with ${previous.label}.`);
        occupied.set(key, command);
      }
    }
  }
  return [...issues];
}

type KeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;
export function bindingFromEvent(event: KeyEvent, mac = isMacPlatform()): KeyBinding {
  const modifiers: Modifier[] = [];
  if (event.ctrlKey) modifiers.push(mac ? "Control" : "Mod");
  if (event.metaKey) modifiers.push(mac ? "Mod" : "Meta");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return { key: event.key.toLowerCase(), modifiers };
}

export function matchShortcut(
  event: KeyboardEvent,
  overrides: ShortcutOverrides,
  scope: "editor" | "canvas",
  model: EditorModel,
  mac = isMacPlatform(),
): CommandId | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.key === "Dead" ||
    event.key === "Process" ||
    event.getModifierState("AltGraph")
  )
    return null;
  const key = signature(bindingFromEvent(event, mac), mac);
  return (
    shortcutCommands.find(
      (command) =>
        (!command.model || command.model === model) &&
        (command.scope === "editor" || scope === "canvas") &&
        (!event.repeat || command.repeat) &&
        commandBindings(command.id, overrides).some((value) => signature(value, mac) === key),
    )?.id ?? null
  );
}

const keyLabels: Record<string, string> = {
  arrowleft: "Left",
  arrowright: "Right",
  arrowup: "Up",
  arrowdown: "Down",
  backspace: "Backspace",
  delete: "Delete",
  pageup: "PageUp",
  pagedown: "PageDown",
};
export function formatBinding(value: KeyBinding, mac = isMacPlatform(), aria = false): string {
  const modifiers = ["Control", "Meta", "Alt", "Shift"]
    .filter((modifier) =>
      value.modifiers.some((item) => (item === "Mod" ? (mac ? "Meta" : "Control") : item) === modifier),
    )
    .map((modifier) => (!aria && modifier === "Control" ? "Ctrl" : !aria && modifier === "Meta" ? "Cmd" : modifier));
  const key =
    aria && value.key === "+"
      ? "plus"
      : aria && value.key.startsWith("arrow")
        ? `Arrow${keyLabels[value.key]}`
        : (keyLabels[value.key] ??
          (value.key.length === 1 ? value.key.toUpperCase() : value.key[0].toUpperCase() + value.key.slice(1)));
  return [...modifiers, key].join("+");
}

export function shortcutLabel(id: CommandId, overrides: ShortcutOverrides, aria = false): string {
  return commandBindings(id, overrides)
    .map((value) => formatBinding(value, isMacPlatform(), aria))
    .join(aria ? " " : " / ");
}
