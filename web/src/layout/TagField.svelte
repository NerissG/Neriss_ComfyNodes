<script lang="ts">
  import { tick } from "svelte";

  export let tags: string[];
  export let onchange: (tags: string[]) => void;
  let draft = "";
  let list: HTMLUListElement | undefined;
  let draggingIndex: number | null = null;
  let dropTarget: { index: number; after: boolean } | null = null;
  let announcement = "";
  let editing: { index: number; tag: string } | null = null;
  let editDraft = "";
  let editError = "";
  let editInput: HTMLInputElement | undefined;

  $: if (editing && tags[editing.index] !== editing.tag) clearEdit();

  function add() {
    const tag = draft.trim();
    if (!tag) return;
    if (!tags.includes(tag)) onchange([...tags, tag]);
    draft = "";
  }
  async function move(index: number, target: number) {
    if (editing || index === target || target < 0 || target >= tags.length) return;
    const next = [...tags];
    const [tag] = next.splice(index, 1);
    if (tag === undefined) return;
    next.splice(target, 0, tag);
    onchange(next);
    announcement = `${tag} moved to position ${target + 1} of ${next.length}.`;
    await focusTag(target);
  }
  async function focusTag(index: number) {
    await tick();
    list?.children.item(index)?.querySelector<HTMLButtonElement>(".drag-handle")?.focus({ preventScroll: true });
  }
  function clearEdit() {
    editing = null;
    editError = "";
  }
  async function startEdit(index: number, tag: string) {
    if (editing && !saveEdit()) return;
    clearDrag();
    editing = { index, tag };
    editDraft = tag;
    editError = "";
    await tick();
    editInput?.focus();
    editInput?.select();
  }
  function saveEdit(): boolean {
    if (!editing) return true;
    const value = editDraft.trim();
    if (!value) {
      editError = "Enter a tag.";
      return false;
    }
    const index = editing.index;
    if (tags.some((tag, position) => position !== index && tag === value)) {
      editError = "This tag already exists.";
      return false;
    }
    if (value !== tags[index]) {
      onchange(tags.map((tag, position) => (position === index ? value : tag)));
      announcement = `Tag updated to ${value}.`;
    }
    clearEdit();
    return true;
  }
  function dragOver(event: DragEvent & { currentTarget: HTMLElement }, index: number) {
    if (draggingIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    dropTarget = draggingIndex === index ? null : { index, after: event.clientX > bounds.left + bounds.width / 2 };
  }
  function clearDrag() {
    draggingIndex = null;
    dropTarget = null;
  }
  function drop(event: DragEvent) {
    if (draggingIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (dropTarget) {
      const slot = dropTarget.index + (dropTarget.after ? 1 : 0);
      void move(draggingIndex, slot - (draggingIndex < slot ? 1 : 0));
    }
    clearDrag();
  }
</script>

<div class="tag-field">
  <form
    onsubmit={(event) => {
      event.preventDefault();
      add();
    }}
  >
    <label
      >Tags<input
        aria-label="Add a tag"
        placeholder="Add a tag…"
        bind:value={draft}
        onkeydown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            draft = "";
          }
        }}
      /></label
    >
    <button type="submit" disabled={!draft.trim()}>Add tag</button>
  </form>
  {#if tags.length}<ul bind:this={list} aria-label="Saved tags">
      {#each tags as tag, index (index)}<li
          class:dragging={draggingIndex === index}
          class:drop-before={dropTarget?.index === index && !dropTarget.after}
          class:drop-after={dropTarget?.index === index && dropTarget.after}
          ondragover={(event) => dragOver(event, index)}
          ondragleave={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
              dropTarget = null;
          }}
          ondrop={drop}
        >
          {#if editing?.index === index}
            <input
              class="tag-edit"
              aria-label={`Edit tag ${tag}`}
              aria-invalid={!!editError}
              bind:this={editInput}
              bind:value={editDraft}
              oninput={() => (editError = "")}
              onblur={() => saveEdit()}
              onkeydown={(event) => {
                if (event.key !== "Enter" && event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Escape") {
                  clearEdit();
                  void focusTag(index);
                } else if (saveEdit()) void focusTag(index);
              }}
            />
          {:else}<button
              type="button"
              class="quiet drag-handle"
              draggable={editing === null}
              aria-label={`Drag to reorder tag ${tag}`}
              title="Drag to reorder; double-click or press Enter to edit; use arrow keys to move"
              ondblclick={() => void startEdit(index, tag)}
              ondragstart={(event) => {
                draggingIndex = index;
                dropTarget = null;
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", tag);
                  if (event.currentTarget.parentElement)
                    event.dataTransfer.setDragImage(event.currentTarget.parentElement, 12, 12);
                }
                event.stopPropagation();
              }}
              ondragend={clearDrag}
              onkeydown={(event) => {
                if (event.key === "Enter" || event.key === "F2") {
                  event.preventDefault();
                  event.stopPropagation();
                  void startEdit(index, tag);
                  return;
                }
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                void move(index, index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1));
              }}><span aria-hidden="true">⠿</span><span>{tag}</span></button
            >{/if}<button
            type="button"
            class="quiet"
            aria-label={`Remove tag ${tag}`}
            onclick={() => {
              clearEdit();
              onchange(tags.filter((_, position) => position !== index));
            }}>×</button
          >
        </li>{/each}
    </ul>{/if}
  {#if editError}<p class="field-error" role="alert">{editError}</p>{/if}
  <span class="sr-only" role="status">{announcement}</span>
</div>

<style>
  form {
    display: flex;
    align-items: end;
    gap: 6px;
  }
  label {
    flex: 1;
    min-width: 0;
  }
  form button {
    margin-bottom: 12px;
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0;
    margin: 0 0 12px;
    list-style: none;
  }
  li {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    background: var(--control);
    padding: 2px 4px;
  }
  li span {
    overflow-wrap: anywhere;
    min-width: 0;
  }
  li button {
    padding: 1px 5px;
  }
  .drag-handle {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    text-align: left;
    white-space: normal;
    cursor: grab;
  }
  li input.tag-edit {
    width: 180px;
    max-width: 100%;
    padding: 1px 5px;
    font-size: inherit;
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .dragging {
    opacity: 0.5;
  }
  .drop-before::before,
  .drop-after::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  .drop-before::before {
    left: -5px;
  }
  .drop-after::after {
    right: -5px;
  }
</style>
