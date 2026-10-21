<script lang="ts">
  import { onMount, tick } from "svelte";
  import { on } from "svelte/events";
  import { formatAppError } from "@/errors";
  import { uiSettings } from "./store";
  import {
    bindingFromEvent,
    bindingSchema,
    commandBindings,
    formatBinding,
    reservedBinding,
    shortcutCommands,
    shortcutIssues,
    type CommandId,
    type ShortcutOverrides,
  } from "./shortcuts";

  export let onclose: () => void;
  let dialog: HTMLDialogElement;
  let drafts: ShortcutOverrides = {};
  let loading = true;
  let saving = false;
  let loaded = false;
  let mounted = false;
  let search = "";
  let error = "";
  let announcement = "";
  let recording: { id: CommandId; index: number | null } | null = null;
  let category = "Tools";
  let actionMenu: { id: CommandId; left: number; top: number; scrollTop: number } | null = null;
  const categories = [
    { id: "Tools", label: "Tools", description: "Choose the active canvas tool." },
    { id: "History & selection", label: "Editing", description: "History and selected regions." },
    { id: "View & panels", label: "View", description: "Canvas framing and sidebar navigation." },
    { id: "Canvas movement", label: "Movement", description: "Move the selected region while the canvas has focus." },
  ];
  $: issues = shortcutIssues(drafts);
  $: query = search.trim().toLowerCase();
  $: commands = shortcutCommands.filter((command) =>
    query ? `${command.label} ${command.category}`.toLowerCase().includes(query) : command.category === category,
  );
  $: activeCategory = categories.find((item) => item.id === category) ?? categories[0];
  $: menuCommand = shortcutCommands.find((command) => command.id === actionMenu?.id);

  async function load() {
    loading = true;
    error = "";
    const result = await uiSettings.ensureLoaded();
    if (!mounted) return;
    loading = false;
    loaded = result.isOk();
    if (result.isErr()) error = formatAppError(result.error);
    else drafts = structuredClone(result.value.editor.shortcuts);
  }

  onMount(() => {
    mounted = true;
    const opener = document.activeElement;
    dialog.showModal();
    void load();
    const removeKeydown = on(dialog, "keydown", (event) => {
      event.stopPropagation();
      if (actionMenu && (event.key === "Escape" || event.key === "Tab")) {
        closeActions();
        if (event.key === "Escape") {
          event.preventDefault();
          return;
        }
      }
      if (event.key === "Tab") {
        if (recording) announcement = "Shortcut recording cancelled.";
        recording = null;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex='0']"),
        ).filter((element) => !element.matches(":disabled") && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      if (!recording) return;
      if (event.key === "Escape") {
        recording = null;
        announcement = "Shortcut recording cancelled.";
        event.preventDefault();
        return;
      }
      event.preventDefault();
      if (event.repeat || event.isComposing || ["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
      if (event.key === "Dead" || event.key === "Process" || event.getModifierState("AltGraph")) {
        announcement = "Finish composing text before recording a shortcut.";
        return;
      }
      const value = bindingFromEvent(event);
      const parsed = bindingSchema.safeParse(value);
      const reserved = reservedBinding(value);
      if (!parsed.success || reserved) {
        announcement = reserved ?? "This key combination cannot be assigned.";
        return;
      }
      const bindings = [...commandBindings(recording.id, drafts)];
      if (recording.index === null) bindings.push(parsed.data);
      else bindings[recording.index] = parsed.data;
      drafts = { ...drafts, [recording.id]: bindings };
      announcement = `Assigned ${formatBinding(parsed.data)}.`;
      recording = null;
    });
    const removeKeyup = on(dialog, "keyup", (event) => event.stopPropagation());
    const removePointerdown = on(dialog, "pointerdown", (event) => {
      if (event.target instanceof Element && !event.target.closest("[data-shortcut-menu]")) actionMenu = null;
    });
    const removeResize = on(window, "resize", () => {
      actionMenu = null;
    });
    return () => {
      mounted = false;
      removeKeydown();
      removeKeyup();
      removePointerdown();
      removeResize();
      dialog.close();
      void tick().then(() => {
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
      });
    };
  });

  async function save() {
    if (!loaded || saving || issues.length || recording) return;
    saving = true;
    error = "";
    const result = await uiSettings.saveEditor({ shortcuts: drafts });
    if (!mounted) return;
    saving = false;
    if (result.isErr()) error = formatAppError(result.error);
    else onclose();
  }

  function reset(id: CommandId) {
    const next = { ...drafts };
    delete next[id];
    drafts = next;
    recording = null;
    closeActions();
  }

  function closeActions() {
    const id = actionMenu?.id;
    actionMenu = null;
    if (id) document.getElementById(`shortcut-options-${id}`)?.focus({ preventScroll: true });
  }

  async function openActions(event: MouseEvent, id: CommandId) {
    if (actionMenu?.id === id) {
      closeActions();
      return;
    }
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement)) return;
    recording = null;
    const anchor = trigger.getBoundingClientRect();
    const bounds = dialog.getBoundingClientRect();
    actionMenu = {
      id,
      left: Math.max(bounds.left + 12, anchor.right - 184),
      top: Math.min(anchor.bottom + 4, bounds.bottom - 180),
      scrollTop: dialog.querySelector(".shortcut-list")?.scrollTop ?? 0,
    };
    await tick();
    dialog.querySelector<HTMLButtonElement>(".shortcut-options button:not(:disabled)")?.focus();
  }

  async function startRecording(id: CommandId, index: number | null) {
    actionMenu = null;
    recording = { id, index };
    announcement = "Press your shortcut. Esc cancels.";
    await tick();
    document.getElementById(`shortcut-binding-${id}-${index ?? "new"}`)?.focus();
  }

  function removeBinding(id: CommandId, index: number) {
    drafts = { ...drafts, [id]: commandBindings(id, drafts).filter((_, i) => i !== index) };
    recording = null;
  }

  function selectCategory(id: string) {
    category = id;
    search = "";
    recording = null;
    actionMenu = null;
    announcement = "";
  }
</script>

<dialog
  bind:this={dialog}
  class="neriss-editor-theme settings-dialog"
  aria-label="Editor settings"
  oncancel={(event) => {
    event.preventDefault();
    if (!saving) onclose();
  }}
>
  <header>
    <div class="dialog-title">
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><rect x="2" y="5" width="20" height="14" rx="3" /><path
          d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10"
        /></svg
      >
      <h2>Keyboard shortcuts</h2>
    </div>
    <button
      type="button"
      class="icon-button close-button"
      disabled={saving}
      onclick={onclose}
      aria-label="Close settings"
      title="Close"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button>
    {#if loaded}
      <div class="search-field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
        <input
          type="search"
          aria-label="Search shortcuts"
          bind:value={search}
          disabled={saving}
          onfocus={() => {
            recording = null;
            actionMenu = null;
          }}
          placeholder="Search commands…"
        />
      </div>
    {/if}
  </header>
  {#if loading}<div class="load-state" role="status">Loading shortcuts…</div>
  {:else if !loaded}
    <div class="load-state">
      <p class="field-error" role="alert">{error} The saved file has not been replaced.</p>
      <button type="button" onclick={load}>Retry loading settings</button>
    </div>
  {:else}
    <div class="workspace">
      <nav class="category-nav" aria-label="Shortcut categories">
        {#each categories as item (item.id)}
          <button
            type="button"
            aria-pressed={!query && category === item.id}
            disabled={saving}
            onclick={() => selectCategory(item.id)}
          >
            <span>{item.label}</span><small
              >{shortcutCommands.filter((command) => command.category === item.id).length}</small
            >
          </button>
        {/each}
      </nav>
      <div class="command-panel">
        <div class="category-heading">
          <div class="category-title">
            <h3>{query ? "Search results" : activeCategory.label}</h3>
            <span>{commands.length}</span>
          </div>
          <p>{query ? "Matching commands across all categories." : activeCategory.description}</p>
        </div>
        <div
          class="shortcut-list"
          aria-label="Keyboard shortcuts"
          onscroll={(event) => {
            // Focus can queue a scroll event before the menu opens. Only dismiss
            // for a new scroll, not that already-completed focus scroll.
            if (actionMenu && event.currentTarget.scrollTop !== actionMenu.scrollTop) actionMenu = null;
          }}
        >
          {#each commands as command (command.id)}
            <div
              class="shortcut-row"
              class:is-recording={recording?.id === command.id}
              role="group"
              aria-label={command.label}
            >
              <div class="command-name">
                <span>{command.label.replace(/ tool$/, "")}</span>
                {#if command.model}<small class="model-badge">MOSS</small>{/if}
                {#if drafts[command.id] !== undefined}<span
                    class="modified-dot"
                    title="Customized"
                    aria-label="Customized"
                  ></span>{/if}
              </div>
              <div class="bindings">
                {#each commandBindings(command.id, drafts) as value, index (index)}
                  <div class="binding">
                    <button
                      type="button"
                      class="binding-trigger"
                      class:recording={recording?.id === command.id && recording.index === index}
                      id={`shortcut-binding-${command.id}-${index}`}
                      aria-label={`Change ${command.label} binding ${index + 1}`}
                      disabled={saving}
                      onclick={() => startRecording(command.id, index)}
                      onblur={() => {
                        if (recording?.id === command.id && recording.index === index) recording = null;
                      }}
                    >
                      {#if recording?.id === command.id && recording.index === index}<span class="recording-prompt"
                          >Press keys…</span
                        >
                      {:else}<kbd>{formatBinding(value)}</kbd>{/if}
                    </button>
                    <button
                      type="button"
                      class="remove-binding"
                      aria-label={`Remove ${command.label} binding ${index + 1}`}
                      title="Remove shortcut"
                      disabled={saving}
                      onclick={() => removeBinding(command.id, index)}>×</button
                    >
                  </div>
                {:else}{#if recording?.id !== command.id}<small class="unassigned">Disabled</small>{/if}{/each}
                {#if recording?.id === command.id && recording.index === null}
                  <button
                    type="button"
                    class="binding-trigger recording"
                    id={`shortcut-binding-${command.id}-new`}
                    aria-label={`Add ${command.label} binding`}
                    onblur={() => {
                      if (recording?.id === command.id && recording.index === null) recording = null;
                    }}
                  >
                    <span class="recording-prompt">Press keys…</span>
                  </button>
                {/if}
              </div>
              <button
                type="button"
                class="icon-button row-options"
                data-shortcut-menu
                id={`shortcut-options-${command.id}`}
                aria-label={`More options for ${command.label}`}
                aria-expanded={actionMenu?.id === command.id}
                aria-controls={actionMenu?.id === command.id ? "shortcut-options" : undefined}
                disabled={saving}
                title="Shortcut options"
                onclick={(event) => openActions(event, command.id)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"
                  ><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg
                >
              </button>
            </div>
          {:else}<div class="empty-state">No matching commands.</div>{/each}
        </div>
      </div>
    </div>
    <div class="feedback" class:has-feedback={!!announcement || issues.length > 0 || !!error}>
      <p class="recording-status" class:idle={!announcement} class:listening={!!recording} role="status">
        {announcement || "Click a shortcut to rebind it. Changes apply to both editors."}
      </p>
      {#if issues.length}<div class="field-error" role="alert">
          {#each issues as issue (issue)}<p>{issue}</p>{/each}
        </div>{/if}
      {#if error}<p class="field-error" role="alert">{error} Your changes have not been saved.</p>{/if}
    </div>
    <footer>
      <button
        type="button"
        class="reset-all"
        aria-label="Reset all shortcuts"
        disabled={saving}
        onclick={() => {
          drafts = {};
          recording = null;
          actionMenu = null;
          announcement = "Default shortcuts restored. Save to apply.";
        }}
        ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></svg>Restore defaults</button
      >
      <button type="button" disabled={saving} onclick={onclose}>Cancel</button>
      <button
        type="button"
        class="save"
        aria-label="Save shortcuts"
        disabled={saving || issues.length > 0 || !!recording}
        onclick={save}>{saving ? "Saving…" : "Save changes"}</button
      >
    </footer>
    {#if actionMenu && menuCommand}
      <div
        class="shortcut-options"
        data-shortcut-menu
        id="shortcut-options"
        role="group"
        aria-label={`${menuCommand.label} options`}
        style:left={`${actionMenu.left}px`}
        style:top={`${actionMenu.top}px`}
      >
        <button
          type="button"
          aria-label={`Add ${menuCommand.label} binding`}
          disabled={commandBindings(menuCommand.id, drafts).length >= 4}
          onclick={() => {
            if (menuCommand) void startRecording(menuCommand.id, null);
          }}>Add shortcut</button
        >
        {#if drafts[menuCommand.id] !== undefined}
          <button
            type="button"
            aria-label={`Reset ${menuCommand.label}`}
            onclick={() => {
              if (menuCommand) reset(menuCommand.id);
            }}>Restore default</button
          >
        {/if}
        {#if commandBindings(menuCommand.id, drafts).length}
          <button
            type="button"
            onclick={() => {
              if (menuCommand) {
                drafts = { ...drafts, [menuCommand.id]: [] };
                closeActions();
              }
            }}>Disable command</button
          >
        {/if}
      </div>
    {/if}
  {/if}
</dialog>

<style>
  .settings-dialog {
    width: min(740px, calc(100vw - 32px));
    height: min(440px, calc(100dvh - 48px));
    max-width: none;
    max-height: none;
    box-sizing: border-box;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface-1);
    color: var(--text);
    box-shadow: 0 24px 64px #0006;
    overflow: hidden;
    pointer-events: auto;
  }
  .settings-dialog::backdrop {
    background: var(--backdrop);
  }
  .settings-dialog[open] {
    display: flex;
    flex-direction: column;
  }
  .settings-dialog > :not(.workspace) {
    flex-shrink: 0;
  }
  header,
  footer {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }
  header {
    padding: 8px 12px;
    gap: 16px;
  }
  .dialog-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex-shrink: 0;
  }
  .dialog-title > svg {
    width: 16px;
    height: 16px;
    color: var(--muted);
  }
  header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .settings-dialog .icon-button {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    padding: 0;
    width: 26px;
    height: 26px;
    border: 0;
    background: transparent;
    color: var(--muted);
    border-radius: 5px;
  }
  .settings-dialog .icon-button:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .close-button {
    order: 2;
  }
  .search-field {
    display: flex;
    align-items: center;
    gap: 8px;
    order: 1;
    flex: 1;
    min-width: 0;
    max-width: 280px;
    margin-left: auto;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--field);
    color: var(--muted);
  }
  .search-field:focus-within {
    border-color: var(--accent-line);
  }
  .search-field input {
    border: 0;
    outline: none;
    background: transparent;
    padding: 5px 0;
    font-size: 12px;
    box-shadow: none;
  }
  .workspace {
    display: flex;
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .category-nav {
    display: flex;
    flex-direction: column;
    flex: 0 0 144px;
    gap: 4px;
    padding: 12px 8px;
    border-right: 1px solid var(--border);
    background: var(--surface-0);
  }
  .category-nav button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    text-align: left;
    border: 0;
    background: transparent;
    color: var(--text-2);
    font-size: 12px;
  }
  .category-nav button:hover {
    background: var(--surface-2);
  }
  .category-nav button[aria-pressed="true"] {
    background: var(--accent-bg);
    color: var(--accent);
  }
  .category-nav small {
    font-size: 10px;
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
  }
  .command-panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .category-heading {
    padding: 14px 20px 10px;
  }
  .category-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .category-title h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }
  .category-title > span {
    color: var(--muted);
    font-size: 11px;
  }
  .category-heading p {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--muted);
  }
  .shortcut-list {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--border-strong) transparent;
    flex: 1;
    padding: 0 8px 8px;
  }
  .shortcut-row {
    display: grid;
    grid-template-columns: minmax(80px, 1fr) auto 24px;
    gap: 8px;
    align-items: center;
    min-height: 42px;
    padding: 6px 6px 6px 12px;
    border-radius: 6px;
  }
  .shortcut-row:hover,
  .shortcut-row:focus-within,
  .shortcut-row.is-recording {
    background: var(--surface-2);
  }
  .command-name {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12px;
    min-width: 0;
  }
  .model-badge {
    color: var(--muted);
    font-size: 9px;
    padding: 1px 4px;
    background: var(--surface-3);
    border-radius: 3px;
  }
  .modified-dot {
    width: 4px;
    height: 4px;
    background: var(--accent);
    border-radius: 50%;
  }
  .bindings,
  .binding {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .bindings {
    justify-content: flex-end;
    flex-wrap: wrap;
    column-gap: 8px;
    row-gap: 4px;
    max-width: 280px;
  }
  .settings-dialog .binding-trigger {
    border: 0;
    padding: 3px 0;
    background: transparent;
    border-radius: 4px;
  }
  .binding-trigger kbd {
    display: block;
    min-width: 26px;
    padding: 3px 7px;
    font:
      11px/1.4 ui-monospace,
      monospace;
    background: var(--surface-3);
    color: var(--text-2);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    box-shadow: 0 1px 0 var(--border-strong);
  }
  .binding-trigger:hover kbd {
    border-color: var(--accent-line);
    color: var(--text);
  }
  .settings-dialog .remove-binding {
    border: 0;
    background: transparent;
    padding: 0;
    width: 16px;
    height: 24px;
    color: var(--muted);
    opacity: 0;
  }
  .binding:hover .remove-binding,
  .binding:focus-within .remove-binding {
    opacity: 1;
  }
  .settings-dialog .remove-binding:hover {
    color: var(--danger);
  }
  .row-options {
    opacity: 0.2;
  }
  .shortcut-row:hover .row-options,
  .shortcut-row:focus-within .row-options,
  .row-options[aria-expanded="true"] {
    opacity: 1;
  }
  .recording-prompt {
    display: block;
    padding: 3px 7px;
    color: var(--accent);
    font-size: 11px;
    border: 1px solid var(--accent-line);
    border-radius: 4px;
    background: var(--accent-bg);
  }
  .unassigned {
    color: var(--placeholder);
    font-size: 11px;
  }
  .feedback {
    padding: 0;
  }
  .feedback.has-feedback {
    padding: 6px 12px 0;
  }
  .recording-status.idle {
    position: absolute;
    width: 1px;
    height: 1px;
    min-height: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .recording-status {
    margin: 0;
    min-height: 16px;
    font-size: 11px;
    color: var(--muted);
  }
  .recording-status.listening {
    color: var(--accent);
  }
  .field-error {
    max-height: 76px;
    overflow-y: auto;
    font-size: 11px;
    margin-top: 6px;
  }
  .field-error p {
    margin: 3px 0;
  }
  footer {
    padding: 8px 12px;
  }
  footer button {
    padding: 5px 10px;
  }
  .settings-dialog .reset-all {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: auto;
    border: 0;
    background: transparent;
    padding: 4px 0;
    color: var(--muted);
    font-size: 11px;
  }
  .reset-all svg {
    width: 13px;
    height: 13px;
  }
  .settings-dialog .reset-all:hover {
    color: var(--text);
  }
  .settings-dialog .save {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 500;
  }
  .settings-dialog .save:hover {
    filter: brightness(1.08);
  }
  .shortcut-options {
    position: fixed;
    z-index: 1;
    width: 184px;
    padding: 4px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface-3);
    box-shadow: 0 8px 24px #0005;
  }
  .shortcut-options button {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 8px;
    font-size: 12px;
  }
  .shortcut-options button:hover {
    background: var(--control-hover);
  }
  .load-state {
    padding: 24px;
    color: var(--muted);
    font-size: 12px;
  }
  .empty-state {
    padding: 36px 12px;
    text-align: center;
    font-size: 12px;
    color: var(--muted);
  }
  @media (hover: none) {
    .row-options {
      opacity: 0.7;
    }
    .settings-dialog .remove-binding {
      opacity: 0.7;
    }
  }
  @media (max-width: 600px) {
    .settings-dialog {
      width: calc(100vw - 24px);
      height: min(480px, calc(100dvh - 24px));
    }
    header {
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 12px;
    }
    .close-button {
      margin-left: auto;
    }
    .search-field {
      order: 3;
      flex-basis: 100%;
      max-width: none;
      margin: 0;
    }
    .workspace {
      flex-direction: column;
    }
    .category-nav {
      flex: 0 0 auto;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 2px;
      border-right: 0;
      border-bottom: 1px solid var(--border);
      padding: 6px;
    }
    .category-nav button {
      justify-content: center;
      padding: 7px 2px;
      font-size: 11px;
    }
    .category-nav small {
      display: none;
    }
    .command-panel {
      min-height: 0;
    }
    .category-heading {
      padding: 12px 14px 8px;
    }
    .shortcut-row {
      grid-template-columns: minmax(70px, 1fr) auto 24px;
      padding-left: 6px;
      gap: 4px;
    }
    .command-name {
      font-size: 11px;
    }
    .bindings {
      max-width: 160px;
      column-gap: 4px;
    }
    .binding-trigger kbd {
      padding: 3px 5px;
      font-size: 10px;
    }
    footer {
      gap: 6px;
    }
    footer button {
      padding: 5px 8px;
      font-size: 11px;
    }
    .settings-dialog .reset-all {
      font-size: 10px;
    }
  }
</style>
