<script lang="ts">
  export let tags: string[];
  export let onchange: (tags: string[]) => void;
  let draft = "";
  function add() {
    const tag = draft.trim();
    if (!tag) return;
    if (!tags.includes(tag)) onchange([...tags, tag]);
    draft = "";
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
  {#if tags.length}<ul aria-label="Saved tags">
      {#each tags as tag, index (index)}<li>
          <span>{tag}</span><button
            type="button"
            class="quiet"
            aria-label={`Remove tag ${tag}`}
            onclick={() => onchange(tags.filter((_, position) => position !== index))}>×</button
          >
        </li>{/each}
    </ul>{/if}
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
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    background: var(--control);
    padding: 2px 4px 2px 10px;
  }
  li span {
    overflow-wrap: anywhere;
    min-width: 0;
  }
  li button {
    padding: 1px 5px;
  }
</style>
