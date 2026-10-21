import { z } from "zod";
import { bindingSchema, commandIdSchema, shortcutIssues } from "./shortcuts";

export const uiSettingsSchema = z
  .strictObject({
    version: z.literal(1),
    editor: z
      .strictObject({
        sidebarWidth: z.number().int().min(300).max(720).default(390),
        shortcuts: z.partialRecord(commandIdSchema, z.array(bindingSchema).max(4)).default({}),
      })
      .default({ sidebarWidth: 390, shortcuts: {} }),
  })
  .superRefine((settings, context) => {
    for (const message of shortcutIssues(settings.editor.shortcuts)) {
      context.addIssue({ code: "custom", path: ["editor", "shortcuts"], message });
    }
  });

export type UiSettings = z.infer<typeof uiSettingsSchema>;
export type EditorPreferences = UiSettings["editor"];
export function defaultUiSettings(): UiSettings {
  return { version: 1, editor: { sidebarWidth: 390, shortcuts: {} } };
}
