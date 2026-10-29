<script lang="ts">
  import LayoutEditor from "@/layout/LayoutEditor.svelte";
  import LoraEditor from "@/lora/LoraEditor.svelte";
  import PresetEditor from "@/resolution/PresetEditor.svelte";
  import { loraEditorNode, presetEditorOpen } from "@/views";
  import "@/ui/theme.css";
</script>

<LayoutEditor />
{#if $presetEditorOpen}
  <PresetEditor onclose={() => presetEditorOpen.set(false)} />
{/if}
{#if $loraEditorNode}
  {#key $loraEditorNode}
    <LoraEditor node={$loraEditorNode} onclose={() => loraEditorNode.set(null)} />
  {/key}
{/if}
