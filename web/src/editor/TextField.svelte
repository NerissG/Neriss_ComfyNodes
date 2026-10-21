<script lang="ts">
  export let label: string;
  export let value: string;
  export let placeholder = "";
  export let onchange: (value: string) => void;
  let expanded = false;

  function autosize(element: HTMLTextAreaElement, value: string) {
    let automaticHeight: string | undefined;

    function resize(value: string) {
      element.value = value;
      // Native drag resizing updates the inline height; keep that user-chosen size.
      if (automaticHeight !== undefined && element.style.height !== automaticHeight) return;
      element.style.height = "auto";
      automaticHeight = `${Math.min(element.scrollHeight + 2, 320)}px`;
      element.style.height = automaticHeight;
    }
    resize(value);
    return { update: resize };
  }
</script>

<div class="text-field" class:expanded>
  <div class="field-heading">
    <span class="field-label">{label}</span>
    <button type="button" class="quiet" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
      {expanded ? "Done" : "Expand"}
    </button>
  </div>
  <textarea
    aria-label={label}
    {value}
    {placeholder}
    rows={3}
    use:autosize={value}
    oninput={(event) => onchange(event.currentTarget.value)}
    onkeydown={(event) => {
      if (event.key === "Escape" && expanded) {
        event.preventDefault();
        event.stopPropagation();
        expanded = false;
      }
    }}></textarea>
</div>
