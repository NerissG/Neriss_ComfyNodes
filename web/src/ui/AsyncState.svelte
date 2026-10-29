<script lang="ts">
  import type { Snippet } from "svelte";
  import Alert from "./Alert.svelte";

  type Props = {
    loading: boolean;
    /** Replaces the content with a retry prompt; leave empty when the content can still be shown. */
    error: string;
    loadingText: string;
    retryText: string;
    onretry: () => void;
    children: Snippet;
  };
  let { loading, error, loadingText, retryText, onretry, children }: Props = $props();
</script>

{#if loading}<p class="empty-state" role="status">{loadingText}</p>
{:else if error}<div class="empty-state">
    <Alert message={error} action={{ label: retryText, onclick: onretry }} />
  </div>
{:else}{@render children()}{/if}
