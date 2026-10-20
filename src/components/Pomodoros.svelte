<script lang="ts">
  import Tomato from './Tomato.svelte';
  let { estimate, actual = 0 }: { estimate: number; actual?: number } =
    $props();
</script>

<span
  class="tomatoes"
  aria-label={`예상 ${estimate}포모도로 / 기록 ${actual}포모도로`}
  >{#each Array(Math.min(6, estimate)) as _, i}<Tomato
      filled={i < Math.floor(actual)}
    />{/each}<span class="pomo-label">{actual} / {estimate}</span></span
>
