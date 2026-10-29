<script lang="ts" module>
  const openDialogs: HTMLDialogElement[] = [];

  /** The topmost open dialog, which owns focus and keyboard input until it closes. */
  export function activeDialog(): HTMLDialogElement | null {
    return openDialogs.at(-1) ?? null;
  }
</script>

<script lang="ts">
  import { onMount, tick, type Snippet } from "svelte";
  import { on } from "svelte/events";
  import { restoreFocus, trapTab } from "./focus";

  type Props = {
    label: string;
    /** Maximum width in pixels; the dialog always fits the viewport. */
    width: number;
    /** Top-aligned dialogs keep their position while their content height changes. */
    align?: "center" | "top";
    /** Blocks Escape while a save is in flight. */
    busy?: boolean;
    onclose: () => void;
    onkeydown?: (event: KeyboardEvent) => void;
    children: Snippet;
  };
  let { label, width, align = "center", busy = false, onclose, onkeydown, children }: Props = $props();
  let dialog: HTMLDialogElement;

  // Dialogs are mounted on document.body, so keep the graph's document and window listeners from seeing their input.
  const isolatedEvents = [
    "keyup",
    "keypress",
    "paste",
    "copy",
    "cut",
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "mousedown",
    "mousemove",
    "mouseup",
    "click",
    "dblclick",
    "auxclick",
    "contextmenu",
    "wheel",
  ];

  onMount(() => {
    const opener = document.activeElement;
    dialog.showModal();
    openDialogs.push(dialog);
    const cleanup = [
      on(dialog, "keydown", (event) => {
        event.stopPropagation();
        onkeydown?.(event);
        if (event.key === "Tab" && !event.defaultPrevented) trapTab(event, dialog);
      }),
      ...isolatedEvents.map((type) => on(dialog, type, (event) => event.stopPropagation())),
    ];
    return () => {
      for (const remove of cleanup) remove();
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      dialog.close();
      void tick().then(() => restoreFocus(opener));
    };
  });
</script>

<dialog
  bind:this={dialog}
  class="neriss-theme neriss-dialog {align}"
  style:--dialog-width={`${width}px`}
  aria-label={label}
  oncancel={(event) => {
    event.preventDefault();
    if (!busy) onclose();
  }}
>
  {@render children()}
</dialog>

<style>
  .neriss-dialog {
    flex-direction: column;
    width: min(var(--dialog-width), calc(100vw - 32px));
    max-width: none;
    max-height: calc(100dvh - 32px);
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface-1);
    box-shadow: none;
    outline: none;
    pointer-events: auto;
  }
  .neriss-dialog[open] {
    display: flex;
  }
  .neriss-dialog.top {
    margin-top: 24px;
    max-height: calc(100dvh - 48px);
  }
  .neriss-dialog::backdrop {
    background: var(--backdrop);
  }
  @media (max-width: 600px) {
    .neriss-dialog {
      width: calc(100vw - 16px);
      max-height: calc(100dvh - 16px);
    }
    .neriss-dialog.top {
      margin-top: 8px;
    }
  }
</style>
