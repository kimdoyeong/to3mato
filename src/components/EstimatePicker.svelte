<script lang="ts">
  import { MAX_TASK_ESTIMATE } from '../lib/domain.mjs';
  let {
    value,
    locked = false,
    label = '예상 포모도로',
    onchange,
  }: {
    value: number;
    locked?: boolean;
    label?: string;
    onchange?: (value: number) => void;
  } = $props();
  const options = Array.from({ length: MAX_TASK_ESTIMATE }, (_, i) => i + 1);
</script>

{#if value > MAX_TASK_ESTIMATE}
  <!-- Estimates above the cap come from older data and stay as they are. -->
  <span class="seg off" role="group" aria-label={label}
    ><span class="seg-b on num" aria-label={`${value} 포모도로`}>{value}</span
    ></span
  >
{:else}
  <span class="seg" class:off={locked} role="group" aria-label={label}>
    {#each options as option (option)}<button
        type="button"
        class="seg-b"
        class:on={value === option}
        aria-pressed={value === option}
        disabled={locked}
        onclick={() => onchange?.(option)}>{option}</button
      >{/each}
  </span>
{/if}
