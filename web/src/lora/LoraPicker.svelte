<script lang="ts">
  import { onMount, tick } from "svelte";
  import { on } from "svelte/events";
  import { filterLoraChoices, prepareLoraChoices } from "./picker";

  export let choices: string[];
  export let value: string;
  export let onchange: (name: string) => void;
  const id = `neriss-lora-picker-${crypto.randomUUID()}`;
  const rowHeight = 40;
  const overscan = 4;
  let root: HTMLDivElement;
  let input: HTMLInputElement;
  let popup: HTMLDivElement;
  let list: HTMLDivElement;
  let open = false;
  let query = "";
  let active = 0;
  let scrollTop = 0;
  let left = 0;
  let top = 0;
  let width = 0;
  let resultsHeight = 280;
  $: entries = prepareLoraChoices(choices);
  $: results = filterLoraChoices(entries, query);
  $: start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  $: end = Math.min(results.length, start + Math.ceil(resultsHeight / rowHeight) + overscan * 2);
  $: visible = results.slice(start, end);
  $: displayValue = value.replace(/\.safetensors$/i, "");
  $: activeId = open && results[active] && active >= start && active < end ? `${id}-${active}` : undefined;

  function position() {
    const bounds = root.getBoundingClientRect();
    width = Math.min(Math.max(bounds.width, 340), window.innerWidth - 24);
    left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12));
    const below = window.innerHeight - bounds.bottom - 16;
    const above = bounds.top - 16;
    const upwards = below < 180 && above > below;
    resultsHeight = Math.min(320, Math.max(40, (upwards ? above : below) - 28));
    const height = Math.min(Math.max(results.length, 1) * rowHeight, resultsHeight) + 28;
    top = upwards ? Math.max(12, bounds.top - height - 4) : bounds.bottom + 4;
  }
  onMount(() => {
    const resize = new ResizeObserver(() => {
      if (open) position();
    });
    resize.observe(root.closest("dialog") ?? root);
    const removeResize = on(window, "resize", () => {
      if (open) position();
    });
    const removeScroll = on(
      window,
      "scroll",
      () => {
        if (open) position();
      },
      { capture: true },
    );
    const removeOutside = on(
      document,
      "pointerdown",
      (event) => {
        if (open && event.target instanceof Node && !root.contains(event.target)) close();
      },
      { capture: true },
    );
    return () => {
      resize.disconnect();
      removeResize();
      removeScroll();
      removeOutside();
    };
  });
  function scrollActive() {
    void tick().then(() => {
      if (!open || !list) return;
      const y = active * rowHeight;
      if (y < list.scrollTop) list.scrollTop = y;
      else if (y + rowHeight > list.scrollTop + list.clientHeight) list.scrollTop = y + rowHeight - list.clientHeight;
      scrollTop = list.scrollTop;
    });
  }
  function show(resetQuery = true) {
    if (resetQuery) query = "";
    active = resetQuery
      ? Math.max(
          0,
          entries.findIndex((entry) => entry.name === value),
        )
      : 0;
    open = true;
    position();
    popup.showPopover();
    scrollActive();
  }
  function close() {
    popup.hidePopover();
    open = false;
    query = "";
  }
  function choose(name: string) {
    close();
    onchange(name);
    input.focus();
  }
  function move(index: number) {
    active = Math.max(0, Math.min(results.length - 1, index));
    scrollActive();
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab" && open) close();
    else if (event.key === "Enter") {
      event.preventDefault();
      if (!open) show();
      else if (results[active]) choose(results[active].name);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show();
      else move(active + (event.key === "ArrowDown" ? 1 : -1));
    } else if (open && ["Home", "End", "PageDown", "PageUp"].includes(event.key)) {
      event.preventDefault();
      move(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? results.length - 1
            : active + (event.key === "PageDown" ? 8 : -8),
      );
    }
  }
</script>

<div
  bind:this={root}
  class="lora-picker"
  onfocusout={(event) => {
    if (open && (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget))) close();
  }}
>
  <input
    bind:this={input}
    role="combobox"
    aria-label="LoRA"
    aria-autocomplete="list"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={id}
    aria-activedescendant={activeId}
    title={value}
    autocomplete="off"
    spellcheck="false"
    placeholder={open ? "Filter by name or folder…" : "Select LoRA…"}
    value={open ? query : displayValue}
    onfocus={() => {
      if (!open) input.select();
    }}
    onclick={() => {
      if (!open) show();
    }}
    oninput={(event) => {
      query = event.currentTarget.value;
      active = 0;
      scrollTop = 0;
      list.scrollTop = 0;
      if (!open) show(false);
    }}
    onkeydown={keydown}
  />
  <button
    type="button"
    class="toggle"
    tabindex="-1"
    aria-label="Toggle LoRA list"
    onkeydown={keydown}
    onclick={() => {
      if (open) close();
      else {
        input.focus();
        show();
      }
    }}>⌄</button
  >
  <div
    bind:this={popup}
    popover="manual"
    class="picker-popup"
    style:left={`${left}px`}
    style:top={`${top}px`}
    style:width={`${width}px`}
    ontoggle={() => {
      open = popup.matches(":popover-open");
      if (!open) query = "";
    }}
  >
    <div class="result-count" role="status" aria-live="polite">
      {results.length.toLocaleString()} / {entries.length.toLocaleString()}
    </div>
    <div
      bind:this={list}
      {id}
      role="listbox"
      aria-label="LoRAs"
      class="results"
      style:height={`${Math.min(Math.max(results.length, 1) * rowHeight, resultsHeight)}px`}
      onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
    >
      <div aria-hidden="true" style:height={`${start * rowHeight}px`}></div>
      {#each visible as entry, offset (entry.name)}
        <button
          id={`${id}-${start + offset}`}
          type="button"
          role="option"
          aria-label={entry.name}
          aria-selected={entry.name === value}
          tabindex="-1"
          class="option"
          class:active={start + offset === active}
          title={entry.name}
          onpointermove={() => (active = start + offset)}
          onclick={() => choose(entry.name)}
        >
          <span class="name">{entry.label}</span>{#if entry.folder}<span class="folder">{entry.folder}</span>{/if}
        </button>
      {/each}
      <div aria-hidden="true" style:height={`${Math.max(0, results.length - end) * rowHeight}px`}></div>
      {#if !results.length}<div class="empty">No matching LoRAs</div>{/if}
    </div>
  </div>
</div>

<style>
  .lora-picker {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 29px;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    background: var(--field);
  }
  .lora-picker:focus-within {
    border-color: var(--accent-line);
  }
  .lora-picker > input {
    flex: 1;
    width: 0;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    height: 27px;
    padding: 4px 8px;
    font-size: 12px;
    text-overflow: ellipsis;
  }
  button.toggle {
    width: 27px;
    height: 27px;
    flex-shrink: 0;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--muted);
  }
  .picker-popup {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    box-shadow: none;
    outline: none;
    background: var(--surface-1);
    color: var(--text);
    overflow: hidden;
  }
  .result-count {
    height: 27px;
    padding: 5px 9px;
    color: var(--muted);
    font-size: 11px;
    border-bottom: 1px solid var(--border);
    font-variant-numeric: tabular-nums;
  }
  .results {
    overflow: auto;
    scrollbar-width: thin;
  }
  button.option {
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 100%;
    height: 40px;
    padding: 4px 9px;
    border: 0;
    border-radius: 0;
    text-align: left;
    background: transparent;
  }
  button.option.active {
    background: var(--accent-bg);
  }
  button.option[aria-selected="true"] .name {
    color: var(--accent);
  }
  .name,
  .folder {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-size: 12px;
    color: var(--text);
  }
  .folder {
    font-size: 10px;
    color: var(--muted);
    margin-top: 1px;
  }
  .empty {
    padding: 10px;
    color: var(--muted);
    font-size: 12px;
  }
</style>
