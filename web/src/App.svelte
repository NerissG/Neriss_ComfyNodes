<script lang="ts">
  import ImageEditor from "@/ImageEditor.svelte";
  import PresetEditor from "@/resolution/PresetEditor.svelte";
  import { presetManagerOpen } from "@/resolution/library";
  import "@/editor/theme.css";
</script>

<ImageEditor />
{#if $presetManagerOpen}
  <PresetEditor oncancel={() => presetManagerOpen.set(false)} />
{/if}
