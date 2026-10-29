<script lang="ts">
  import { onMount } from "svelte";
  import { on } from "svelte/events";
  import { targetMultiplier } from "./state";
  import {
    blockChanged,
    chartRange,
    clampStrength,
    familyModules,
    formatWeights,
    hasOverridesWithin,
    parseWeights,
    weightChanges,
    type BlockFamily,
    type ChartTarget,
  } from "./blocks";

  export let family: BlockFamily;
  export let targets: ChartTarget[];
  export let lens: string;
  export let overrides: Record<string, number>;
  export let matching: Set<string>;
  export let selected: Set<string>;
  export let active: string | null;
  export let disabled: boolean;
  export let onchange: (changes: Record<string, number>, group: string | null) => void;
  export let onlens: (lens: string) => void;
  export let onreset: (names: string[]) => void;
  export let oninherit: (name: string) => void;
  export let oninspect: (block: string) => void;
  export let onselect: (name: string, mode: "toggle" | "range") => void;
  type Point = { index: number; value: number };
  type Range = { lo: number; hi: number };
  type Stroke = { pointer: number; x: number; y: number; last: Point | null; group: string; range: Range };
  let plot: HTMLDivElement;
  let bars: HTMLDivElement[] = [];
  let stroke: Stroke | null = null;
  let strokes = 0;
  let weightsInput: HTMLInputElement | undefined;
  let draft: string;
  let invalid: boolean;
  let plotWidth = 0;
  $: modules = familyModules(family);
  $: names = targets.map((target) => target.name);
  $: values = names.map((name) => targetMultiplier(name, overrides));
  $: range = stroke?.range ?? chartRange(values);
  $: ticks = [...new Set([range.lo, 0, 1, range.hi])];
  $: labelStep = Math.max(1, Math.ceil((18 * targets.length) / Math.max(plotWidth, 1)));
  $: focusable = targets.some((target) => target.block.name === active) ? active : targets[0]?.block.name;
  $: resettable = hasOverridesWithin(overrides, names);
  $: synced = formatWeights(values);
  $: {
    draft = synced;
    invalid = false;
  }
  $: weightsInput?.setCustomValidity(invalid ? `Enter ${targets.length} values from -20 to 20` : "");

  onMount(() => on(plot, "wheel", wheel, { passive: false }));

  function percent(value: number, current: Range): number {
    return ((value - current.lo) / (current.hi - current.lo)) * 100;
  }
  function format(value: number): string {
    return String(Number(value.toFixed(2)));
  }
  function changed(target: ChartTarget): boolean {
    return lens
      ? targetMultiplier(target.name, overrides) !== 1 || hasOverridesWithin(overrides, [target.name])
      : blockChanged(target.block, overrides);
  }
  function apply(next: number[], group: string | null = null) {
    const changes = weightChanges(names, overrides, next);
    if (Object.keys(changes).length) onchange(changes, group);
  }
  function commitWeights() {
    const parsed = parseWeights(draft, targets.length);
    invalid = parsed.isErr();
    if (parsed.isOk()) apply(parsed.value);
  }
  function point(x: number, y: number, fine: boolean, current: Range): Point {
    const bounds = plot.getBoundingClientRect();
    const index = Math.floor(((x - bounds.left) / bounds.width) * targets.length);
    const fraction = Math.max(0, Math.min(1, (y - bounds.top) / bounds.height));
    const step = fine ? 0.01 : 0.05;
    const raw = current.hi - fraction * (current.hi - current.lo);
    return {
      index: Math.max(0, Math.min(targets.length - 1, index)),
      value: clampStrength(Math.round(raw / step) * step),
    };
  }
  function paint(event: PointerEvent, current: Stroke) {
    const fine = event.altKey;
    const from = current.last ?? point(current.x, current.y, fine, current.range);
    const to = point(event.clientX, event.clientY, fine, current.range);
    const step = fine ? 0.01 : 0.05;
    const next = [...values];
    const span = to.index - from.index;
    for (let index = Math.min(from.index, to.index); index <= Math.max(from.index, to.index); index++) {
      const t = span ? (index - from.index) / span : 1;
      next[index] = clampStrength(Math.round((from.value + t * (to.value - from.value)) / step) * step);
    }
    current.last = to;
    apply(next, current.group);
  }
  function pointerdown(event: PointerEvent) {
    if (disabled || event.button !== 0 || !targets.length) return;
    const target = targets[point(event.clientX, event.clientY, false, range).index];
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      onselect(target.name, event.shiftKey ? "range" : "toggle");
      return;
    }
    oninspect(target.block.name);
    plot.setPointerCapture(event.pointerId);
    stroke = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      last: null,
      group: `paint-${++strokes}`,
      range,
    };
  }
  function pointermove(event: PointerEvent) {
    if (!stroke || stroke.pointer !== event.pointerId) return;
    if (!stroke.last && Math.hypot(event.clientX - stroke.x, event.clientY - stroke.y) < 3) return;
    paint(event, stroke);
  }
  function nudge(scope: string[], amount: number, group: string) {
    onchange(
      Object.fromEntries(scope.map((name) => [name, clampStrength(targetMultiplier(name, overrides) + amount)])),
      group,
    );
  }
  // Only selected or active bars react, so scrolling across the chart still scrolls the editor.
  function wheel(event: WheelEvent) {
    if (disabled || !targets.length) return;
    const target = targets[point(event.clientX, event.clientY, false, range).index];
    const scope = selected.has(target.name) ? [...selected] : target.block.name === active ? [target.name] : [];
    const direction = -Math.sign(event.deltaY || event.deltaX);
    if (!scope.length || !direction) return;
    event.preventDefault();
    nudge(scope, direction * (event.shiftKey ? 0.1 : event.altKey ? 0.01 : 0.05), `wheel-${scope.join()}`);
  }
  function focusBar(index: number) {
    bars[Math.max(0, Math.min(targets.length - 1, index))]?.focus();
  }
  function keydown(event: KeyboardEvent, index: number) {
    const target = targets[index];
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") focusBar(index + (event.key === "ArrowLeft" ? -1 : 1));
    else if (event.key === "Home" || event.key === "End") focusBar(event.key === "Home" ? 0 : targets.length - 1);
    else if (disabled) return;
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const amount = (event.shiftKey ? 0.1 : event.altKey ? 0.01 : 0.05) * (event.key === "ArrowUp" ? 1 : -1);
      nudge([target.name], amount, `key-${target.name}`);
    } else if (event.key === "Delete" || event.key === "Backspace") oninherit(target.name);
    else if (event.key === " ") onselect(target.name, event.shiftKey ? "range" : "toggle");
    else return;
    event.preventDefault();
  }
</script>

<section class="family" aria-label={family.label}>
  <div class="family-head">
    <h3 title={family.name || "Unnumbered targets"}>{family.label} <small>{family.blocks.length}</small></h3>
    {#if modules.length}
      <select
        class="lens"
        aria-label={`Module ${family.label}`}
        title="Edit one module across every block"
        value={lens}
        onchange={(event) => onlens(event.currentTarget.value)}
      >
        <option value="">Whole blocks</option>
        {#each modules as module (module.label)}
          <option value={module.label}
            >{module.count < family.blocks.length
              ? `${module.label} (${module.count}/${family.blocks.length})`
              : module.label}</option
          >
        {/each}
      </select>
    {/if}
    <input
      bind:this={weightsInput}
      class="weights"
      aria-label={`Weights ${family.label}`}
      aria-invalid={invalid}
      title={invalid ? `Enter ${targets.length} values from -20 to 20` : "Comma-separated weights; paste to apply"}
      spellcheck="false"
      autocomplete="off"
      value={draft}
      {disabled}
      onfocus={(event) => event.currentTarget.select()}
      oninput={(event) => {
        draft = event.currentTarget.value;
        invalid = false;
      }}
      onchange={commitWeights}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitWeights();
        }
      }}
    />
    <button
      type="button"
      class="reset"
      aria-label={`Reset ${family.label}`}
      title={lens ? `Remove ${lens} overrides in ${family.label}` : `Remove all overrides in ${family.label}`}
      disabled={disabled || !resettable}
      onclick={() => onreset(names)}>Reset</button
    >
  </div>
  <div class="chart">
    <div class="axis" aria-hidden="true">
      {#each ticks as tick (tick)}<span style:bottom={`${percent(tick, range)}%`}>{format(tick)}</span>{/each}
    </div>
    <div
      bind:this={plot}
      bind:clientWidth={plotWidth}
      class="plot"
      class:disabled
      style:--columns={targets.length}
      role="presentation"
      onpointerdown={pointerdown}
      onpointermove={pointermove}
      onlostpointercapture={() => (stroke = null)}
    >
      <div class="line zero" style:bottom={`${percent(0, range)}%`}></div>
      <div class="line one" style:bottom={`${percent(1, range)}%`}></div>
      {#each targets as target, index (target.name)}
        {@const value = values[index]}
        <div
          bind:this={bars[index]}
          class="bar"
          class:selected={selected.has(target.name)}
          class:active={active === target.block.name}
          class:dim={!matching.has(target.block.name)}
          role="slider"
          tabindex={focusable === target.block.name ? 0 : -1}
          aria-label={`Multiplier ${target.name}`}
          aria-valuemin={-20}
          aria-valuemax={20}
          aria-valuenow={value}
          aria-disabled={disabled}
          title={`${target.block.label}${lens ? ` ${lens}` : ""}: ${format(value)}`}
          onfocus={() => oninspect(target.block.name)}
          onkeydown={(event) => keydown(event, index)}
        >
          <span
            class="fill"
            class:raise={value > 1}
            class:lower={value < 1}
            style:bottom={`${percent(Math.min(0, value), range)}%`}
            style:height={`${Math.abs(percent(value, range) - percent(0, range))}%`}
          ></span>
          <span class="value">{format(value)}</span>
        </div>
      {/each}
    </div>
    <div class="labels" style:--columns={targets.length} aria-hidden="true">
      {#each targets as target, index (target.name)}
        <span class:changed={changed(target)} class:dim={!matching.has(target.block.name)}
          >{index % labelStep === 0 ? target.block.short : ""}</span
        >
      {/each}
    </div>
  </div>
</section>

<style>
  .family-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  h3 {
    margin: 0;
    min-width: 92px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
    white-space: nowrap;
  }
  small {
    margin-left: 3px;
    font-size: 10px;
    color: var(--muted);
  }
  .lens {
    width: auto;
    max-width: 220px;
    height: 26px;
    padding: 2px 6px;
    font-size: 11px;
  }
  .weights {
    flex: 1;
    min-width: 120px;
    height: 26px;
    padding: 3px 7px;
    font:
      11px ui-monospace,
      monospace;
    color: var(--text-2);
  }
  .weights[aria-invalid="true"] {
    border-color: var(--danger);
  }
  .reset {
    padding: 3px 9px;
    font-size: 11px;
  }
  .chart {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr);
    column-gap: 4px;
  }
  .axis {
    position: relative;
    font-size: 9.5px;
    color: var(--placeholder);
    font-variant-numeric: tabular-nums;
  }
  .axis span {
    position: absolute;
    right: 0;
    transform: translateY(50%);
    line-height: 1;
  }
  .plot,
  .labels {
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    gap: 2px;
  }
  .plot {
    position: relative;
    height: clamp(96px, 18dvh, 200px);
    touch-action: none;
    user-select: none;
    cursor: ns-resize;
  }
  .plot.disabled {
    cursor: default;
    opacity: 0.5;
  }
  .line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--border);
    pointer-events: none;
  }
  .line.one {
    border-top: 1px dashed var(--accent-line);
  }
  .bar {
    position: relative;
    min-width: 0;
    border-radius: 3px;
    outline: none;
  }
  .bar:hover {
    background: var(--surface-2);
  }
  .bar.selected {
    background: var(--accent-bg);
  }
  .bar.active {
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }
  .bar:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .bar.dim,
  .labels .dim {
    opacity: 0.28;
  }
  .fill {
    position: absolute;
    left: 50%;
    width: min(64%, 22px);
    transform: translateX(-50%);
    border-radius: 2px;
    background: var(--bar-neutral);
    pointer-events: none;
  }
  .fill.raise {
    background: var(--bar-raise);
  }
  .fill.lower {
    background: var(--bar-lower);
  }
  .value {
    position: absolute;
    top: 1px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 9.5px;
    line-height: 1;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-shadow: 0 0 3px var(--surface-0);
    pointer-events: none;
    opacity: 0;
  }
  .bar:hover .value,
  .bar.active .value,
  .bar.selected .value,
  .bar:focus-visible .value {
    opacity: 1;
  }
  .labels {
    grid-column: 2;
    margin-top: 3px;
  }
  .labels span {
    overflow: hidden;
    font-size: 9.5px;
    line-height: 12px;
    text-align: center;
    white-space: nowrap;
    color: var(--placeholder);
    font-variant-numeric: tabular-nums;
  }
  .labels span.changed {
    color: var(--accent);
  }
  @media (max-width: 720px) {
    .family-head {
      flex-wrap: wrap;
    }
    .weights {
      order: 3;
      flex-basis: 100%;
    }
    .reset {
      margin-left: auto;
    }
  }
</style>
