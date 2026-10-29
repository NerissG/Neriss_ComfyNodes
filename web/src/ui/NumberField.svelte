<script lang="ts">
  type Props = {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number | "any";
    /** Adds −/+ buttons and arrow-key steps of this size (Shift doubles, Alt is a fifth). */
    nudge?: number;
    /** Renders only the input, labelled for assistive technology, for dense rows. */
    compact?: boolean;
    disabled?: boolean;
    onchange: (value: number) => void;
  };
  let {
    label,
    value,
    min = -Infinity,
    max = Infinity,
    step = 1,
    nudge,
    compact = false,
    disabled = false,
    onchange,
  }: Props = $props();
  let input = $state<HTMLInputElement | undefined>();
  let draft = $derived(String(value));
  // The rejected text stays marked until it is edited or the committed value changes.
  let rejected = $state<string | null>(null);
  const invalid = $derived(rejected === draft);
  const message = $derived(
    Number.isFinite(max)
      ? `Enter a number from ${min} to ${max}`
      : Number.isFinite(min)
        ? `Enter a number of at least ${min}`
        : "Enter a valid number",
  );
  $effect(() => input?.setCustomValidity(invalid ? message : ""));

  function commit() {
    const number = draft.trim() ? Number(draft) : NaN;
    if (!Number.isFinite(number) || number < min || number > max) {
      rejected = draft;
      return;
    }
    rejected = null;
    onchange(number);
  }
  function nudgeBy(amount: number) {
    const number = Number(draft);
    const base = draft.trim() && Number.isFinite(number) ? number : value;
    onchange(Math.max(min, Math.min(max, Number((base + amount).toFixed(4)))));
  }
</script>

{#snippet control()}
  <input
    bind:this={input}
    type="number"
    aria-label={label}
    aria-invalid={invalid}
    title={invalid ? message : undefined}
    min={Number.isFinite(min) ? min : undefined}
    max={Number.isFinite(max) ? max : undefined}
    {step}
    {disabled}
    required
    value={draft}
    oninput={(event) => (draft = event.currentTarget.value)}
    onchange={commit}
    onkeydown={(event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape" && draft !== String(value)) {
        event.stopPropagation();
        draft = String(value);
      } else if (nudge && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        nudgeBy(nudge * (event.shiftKey ? 2 : event.altKey ? 0.2 : 1) * (event.key === "ArrowUp" ? 1 : -1));
      }
    }}
  />
{/snippet}

{#snippet stepper()}
  {#if nudge}
    <div class="stepper">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        title={`−${nudge}`}
        {disabled}
        onclick={() => nudgeBy(-nudge)}>−</button
      >{@render control()}<button
        type="button"
        aria-label={`Increase ${label}`}
        title={`+${nudge}`}
        {disabled}
        onclick={() => nudgeBy(nudge)}>+</button
      >
    </div>
  {:else}{@render control()}{/if}
{/snippet}

{#if compact}{@render stepper()}{:else}
  <label>
    {label}
    {@render stepper()}
    {#if invalid}<span class="field-error">{message}.</span>{/if}
  </label>
{/if}

<style>
  .stepper {
    display: flex;
    align-items: center;
    height: 25px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--field);
    flex-shrink: 0;
  }
  .stepper:focus-within {
    border-color: var(--accent-line);
  }
  .stepper:has(input[aria-invalid="true"]) {
    border-color: var(--danger);
  }
  .stepper button {
    padding: 0;
    width: 20px;
    height: 23px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
  }
  .stepper input {
    width: 44px;
    padding: 2px 0;
    height: 23px;
    border: 0;
    border-radius: 0;
    outline: none;
    background: transparent;
    text-align: center;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    appearance: textfield;
  }
  .stepper input::-webkit-inner-spin-button,
  .stepper input::-webkit-outer-spin-button {
    appearance: none;
    margin: 0;
  }
</style>
