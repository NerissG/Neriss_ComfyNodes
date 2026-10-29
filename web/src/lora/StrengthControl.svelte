<script lang="ts">
  import { strengthSchema } from "./state";

  export let label: string;
  export let value: number;
  export let disabled = false;
  export let onchange: (value: number) => void;
  let input: HTMLInputElement | undefined;
  let draft = String(value);
  let invalid: boolean;
  $: {
    draft = String(value);
    invalid = false;
  }
  $: input?.setCustomValidity(invalid ? "Enter a number from -20 to 20" : "");

  function commit() {
    const parsed = strengthSchema.safeParse(draft.trim() ? Number(draft) : NaN);
    invalid = !parsed.success;
    if (parsed.success) onchange(parsed.data);
  }
  function nudge(amount: number) {
    const number = Number(draft);
    const base = draft.trim() && Number.isFinite(number) ? number : value;
    onchange(Math.max(-20, Math.min(20, Number((base + amount).toFixed(4)))));
  }
</script>

<div class="strength-control">
  <div class="stepper">
    <button type="button" aria-label={`Decrease ${label}`} title="−0.05" {disabled} onclick={() => nudge(-0.05)}
      >−</button
    >
    <input
      bind:this={input}
      type="number"
      aria-label={label}
      aria-invalid={invalid}
      title={invalid ? "Enter a number from -20 to 20" : undefined}
      min="-20"
      max="20"
      step="any"
      value={draft}
      {disabled}
      required
      oninput={(event) => {
        draft = event.currentTarget.value;
        invalid = false;
      }}
      onchange={commit}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          nudge((event.shiftKey ? 0.1 : event.altKey ? 0.01 : 0.05) * (event.key === "ArrowUp" ? 1 : -1));
        }
      }}
    />
    <button type="button" aria-label={`Increase ${label}`} title="+0.05" {disabled} onclick={() => nudge(0.05)}
      >+</button
    >
  </div>
</div>

<style>
  .strength-control {
    display: flex;
    align-items: center;
    min-width: 0;
  }
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
  .stepper:has(input[aria-invalid="true"]) {
    border-color: var(--danger);
  }
</style>
