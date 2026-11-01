import type { CommandId } from "@/settings/shortcuts";
import type { IconName } from "@/ui/Icon.svelte";

export type CanvasTool = "select" | "obj" | "character" | "text" | "pan" | "redraw";

export const canvasTools: {
  id: Exclude<CanvasTool, "redraw">;
  label: string;
  command: Extract<CommandId, `tool.${string}`>;
  icon: IconName;
  hint?: string;
}[] = [
  {
    id: "select",
    label: "Select",
    command: "tool.select",
    icon: "pointer",
    hint: "Ctrl/Cmd-click cycles through overlapping boxes",
  },
  {
    id: "pan",
    label: "Pan",
    command: "tool.pan",
    hint: "Or hold Space and drag",
    icon: "pan",
  },
  {
    id: "character",
    label: "Character",
    command: "tool.character",
    icon: "character",
  },
  {
    id: "obj",
    label: "Object",
    command: "tool.object",
    icon: "object",
  },
  { id: "text", label: "Text", command: "tool.text", icon: "text" },
];
