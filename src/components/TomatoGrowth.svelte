<script lang="ts">
  import type { TomatoScene } from '../lib/tomato-scene';
  import Mascot from './Mascot.svelte';
  let {
    progress = 0,
    running = false,
  }: {
    progress?: number;
    running?: boolean;
  } = $props();
  let host = $state<HTMLDivElement>();
  let scene = $state<TomatoScene | null>(null);
  // Without WebGL or the models the timer keeps the drawn mascot.
  let failed = $state(false);
  $effect(() => {
    let active = true;
    let created: TomatoScene | null = null;
    import('../lib/tomato-scene')
      .then(({ createTomatoScene }) => createTomatoScene(host!))
      .then((result) => {
        created = result;
        if (active) scene = result;
        else result.dispose();
      })
      .catch(() => (failed = true));
    return () => {
      active = false;
      created?.dispose();
      scene = null;
    };
  });
  $effect(() => scene?.update(progress, running));
</script>

{#if failed}
  <Mascot phase="focus" paused={!running} />
{:else}
  <div
    class="tomato-growth"
    data-ready={!!scene}
    bind:this={host}
    aria-hidden="true"
  ></div>
{/if}

<style>
  .tomato-growth {
    width: 168px;
    height: 150px;
    margin: -8px auto 2px;
    opacity: 0;
    transition: opacity 0.3s;
  }
  .tomato-growth[data-ready='true'] {
    opacity: 1;
  }
  .tomato-growth :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
