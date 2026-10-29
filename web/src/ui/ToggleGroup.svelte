<script lang="ts" generics="T">
  type Item = { id: T; label: string; count?: number; title?: string; shortcut?: string };
  type Props = {
    label: string;
    items: Item[];
    /** No item is pressed when the value matches none of them, such as during a search. */
    value: T;
    vertical?: boolean;
    /** Stretches items to share the full width equally. */
    fill?: boolean;
    disabled?: boolean;
    class?: string;
    onselect: (id: T) => void;
  };
  let {
    label,
    items,
    value,
    vertical = false,
    fill = false,
    disabled = false,
    class: className = "",
    onselect,
  }: Props = $props();
</script>

<div class="toggle-group {className}" class:vertical class:fill role="group" aria-label={label}>
  {#each items as item (item.id)}
    <button
      type="button"
      aria-pressed={item.id === value}
      aria-keyshortcuts={item.shortcut}
      title={item.title}
      {disabled}
      onclick={() => onselect(item.id)}
      >{item.label}{#if item.count !== undefined}
        <small>{item.count}</small>{/if}</button
    >
  {/each}
</div>

<style>
  .toggle-group {
    display: flex;
    gap: 3px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .toggle-group.vertical {
    flex-direction: column;
    gap: 4px;
    overflow: visible;
  }
  .toggle-group button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 4px 8px;
    border: 0;
    background: transparent;
    color: var(--text-2);
    font-size: 11px;
  }
  .fill button {
    flex: 1;
    justify-content: center;
    padding: 6px 10px;
    font-size: 12px;
  }
  .vertical button {
    padding: 8px 10px;
    font-size: 12px;
    text-align: left;
  }
  .toggle-group button:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .toggle-group button[aria-pressed="true"] {
    color: var(--accent);
    background: var(--accent-bg);
  }
  small {
    color: var(--muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
</style>
