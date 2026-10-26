<script lang="ts">
  import Paper from './Paper.svelte';
  import Tomato from '../Tomato.svelte';
  let {
    capacity,
    allocated,
    done,
  }: { capacity: number; allocated: number; done: number } = $props();
  // 가능한 수만큼 연필 토마토가 놓이고, 배치한 만큼 옅게 칠해지고, 완료한 만큼 빨간 도장이 찍힌다.
  // 가능을 넘긴 배치는 빨간 점선 토마토로 더 붙는다.
  const slots = $derived(
    Array.from({ length: Math.max(capacity, allocated) }, (_, i) =>
      i >= capacity
        ? 'over'
        : i < done
          ? 'filled'
          : i < allocated
            ? 'plan'
            : 'empty',
    ),
  );
  const over = $derived(allocated - capacity);
</script>

<Paper tilt="c" tape="left" class="capacity-row">
  <div class="capacity-slots" aria-hidden="true">
    {#each slots as variant, i (i)}<Tomato {variant} size="lg" />{/each}
  </div>
  <div class="capacity-figures muted">
    <span>배치 <b class="num">{allocated}</b></span>
    <span>완료 <b class="num">{done}</b></span>
    {#if over > 0}<span class="capacity-over"
        >초과 <b class="num">{over}</b></span
      >{/if}
  </div>
</Paper>

<style>
  :global(.capacity-row) {
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .capacity-slots {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }
  .capacity-figures {
    display: flex;
    gap: 16px;
    font-size: var(--text-sm);
    margin-left: auto;
  }
  .capacity-figures b {
    font-weight: 400;
    font-size: var(--text-md);
    color: var(--ink);
  }
  .capacity-over,
  .capacity-over b {
    color: var(--red-deep);
  }
</style>
