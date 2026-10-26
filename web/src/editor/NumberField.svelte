<script lang="ts">
  import { z } from "zod";
  export let label: string;
  export let value: number;
  export let min = -Infinity;
  export let max = Infinity;
  export let step = 1;
  export let disabled = false;
  export let onchange: (value: number) => void;
  let draft = String(value);
  let error = "";
  $: draft = String(value);

  function commit() {
    const parsed = z.string().trim().min(1).pipe(z.coerce.number<string>().finite().min(min).max(max)).safeParse(draft);
    if (!parsed.success) {
      error = "Enter a valid number within the allowed range.";
      return;
    }
    error = "";
    onchange(parsed.data);
  }
</script>

<label>
  {label}
  <input
    aria-label={label}
    type="number"
    min={Number.isFinite(min) ? min : undefined}
    max={Number.isFinite(max) ? max : undefined}
    {step}
    {disabled}
    value={draft}
    aria-invalid={!!error}
    oninput={(event) => {
      draft = event.currentTarget.value;
      error = "";
    }}
    onchange={commit}
    onkeydown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") {
        event.stopPropagation();
        draft = String(value);
        error = "";
      }
    }}
  />
  {#if error}<span class="field-error">{error}</span>{/if}
</label>
