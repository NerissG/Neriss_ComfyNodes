import type { CommandId } from "@/settings/shortcuts";

export type CanvasTool = "select" | "obj" | "character" | "text" | "pan" | "redraw";

export const canvasTools: {
  id: Exclude<CanvasTool, "redraw">;
  label: string;
  command: Extract<CommandId, `tool.${string}`>;
  icon: string;
  hint?: string;
}[] = [
  {
    id: "select",
    label: "Select",
    command: "tool.select",
    icon: "M5 3l6 17 2.5-7 7-2.5z",
    hint: "Ctrl/Cmd-click cycles through overlapping boxes",
  },
  {
    id: "obj",
    label: "Object",
    command: "tool.object",
    icon: "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 8v8M8 12h8",
  },
  {
    id: "character",
    label: "Character",
    command: "tool.character",
    icon: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  },
  { id: "text", label: "Text", command: "tool.text", icon: "M5 7V4h14v3M12 4v16M9 20h6" },
  {
    id: "pan",
    label: "Pan",
    command: "tool.pan",
    hint: "Or hold Space and drag",
    icon: "M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3",
  },
];
