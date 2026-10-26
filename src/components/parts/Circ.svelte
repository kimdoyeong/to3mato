<script lang="ts">
  import Icon from '../Icon.svelte';
  let {
    n,
    state = '',
    class: className = '',
  }: {
    n: number | 'check';
    state?: '' | 'on' | 'ok';
    class?: string;
  } = $props();
</script>

<span class="circ {state} {className}"
  ><svg viewBox="0 0 30 30" aria-hidden="true"
    ><path
      d="M15.5 3.5c6.5-1 11.5 4 11 11.5S22 27 15 26.5 3 22.5 3.5 15 9 4.5 15.5 3.5Z"
      stroke-width="1.6"
    /></svg
  >{#if n === 'check'}<Icon name="check" />{:else}<span>{n}</span>{/if}</span
>
