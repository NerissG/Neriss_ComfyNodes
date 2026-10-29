<script lang="ts">
  import ImageEditor from "@/ImageEditor.svelte";
  import PresetEditor from "@/resolution/PresetEditor.svelte";
  import { presetManagerOpen } from "@/resolution/library";
  import StrengthEditor from "@/lora/StrengthEditor.svelte";
  import { loraEditorNode } from "@/lora/services";
  import "@/editor/theme.css";
</script>

<ImageEditor />
{#if $presetManagerOpen}
  <PresetEditor oncancel={() => presetManagerOpen.set(false)} />
{/if}
{#if $loraEditorNode}
  {#key $loraEditorNode}
    <StrengthEditor node={$loraEditorNode} oncancel={() => loraEditorNode.set(null)} />
  {/key}
{/if}
