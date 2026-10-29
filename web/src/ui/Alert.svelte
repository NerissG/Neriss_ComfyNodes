<script lang="ts">
  type Props = {
    message: string;
    /** A recovery step shown beside the message, such as retrying a request. */
    action?: { label: string; onclick: () => void; disabled?: boolean };
  };
  let { message, action }: Props = $props();
</script>

<p class="alert" role="alert">
  {message}{#if action}<button type="button" disabled={action.disabled} onclick={action.onclick}>{action.label}</button
    >{/if}
</p>

<style>
  .alert {
    margin: 4px 0;
    color: var(--danger);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .alert button {
    margin-left: 6px;
    padding: 2px 6px;
    font-size: 11px;
  }
</style>
