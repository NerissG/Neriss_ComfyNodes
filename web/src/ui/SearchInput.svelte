<script lang="ts">
  import Icon from "./Icon.svelte";

  type Props = {
    label: string;
    value: string;
    placeholder?: string;
    disabled?: boolean;
    class?: string;
    onfocus?: () => void;
    oninput?: () => void;
  };
  let {
    label,
    value = $bindable(),
    placeholder,
    disabled = false,
    class: className = "",
    onfocus,
    oninput,
  }: Props = $props();
  let input: HTMLInputElement;

  export function focus() {
    input.focus();
  }
</script>

<div class="search-input {className}">
  <Icon name="search" size={14} />
  <input bind:this={input} type="search" aria-label={label} {placeholder} {disabled} bind:value {onfocus} {oninput} />
</div>

<style>
  .search-input {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 29px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--field);
    color: var(--muted);
  }
  .search-input:focus-within {
    border-color: var(--accent-line);
  }
  .search-input input {
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    font-size: 12px;
  }
</style>
