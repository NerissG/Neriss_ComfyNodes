<script lang="ts">
  import type { EditorState } from "@/editor/state";
  import TagField from "@/editor/TagField.svelte";
  import TextField from "@/editor/TextField.svelte";
  export let state: EditorState;
  export let onchange: (state: EditorState) => void;
</script>

<section>
  <h2>Scene &amp; style</h2>
  <TextField
    label="Scene caption"
    value={state.high_level_description}
    placeholder="Describe the overall scene, background, and visual style…"
    onchange={(high_level_description) => onchange({ ...state, high_level_description })}
  />
  <TagField tags={state.moss_meta} onchange={(moss_meta) => onchange({ ...state, moss_meta })} />
</section>
