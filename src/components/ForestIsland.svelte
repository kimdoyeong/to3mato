<script lang="ts">
  import type { ForestItem, ForestScene } from '../lib/forest-scene';
  let { items }: { items: ForestItem[] } = $props();
  let host = $state<HTMLDivElement>();
  let scene = $state<ForestScene | null>(null);
  // Without WebGL or the models the log simply has no island.
  let failed = $state(false);
  $effect(() => {
    let active = true;
    let created: ForestScene | null = null;
    import('../lib/forest-scene')
      .then(({ createForestScene }) => createForestScene(host!))
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
  $effect(() => scene?.update(items));
</script>

{#if !failed}
  <div
    class="forest-island"
    data-ready={!!scene}
    bind:this={host}
    aria-hidden="true"
  ></div>
{/if}

<style>
  .forest-island {
    height: 260px;
    margin: 4px 0 18px;
    opacity: 0;
    transition: opacity 0.3s;
    cursor: grab;
  }
  .forest-island:active {
    cursor: grabbing;
  }
  .forest-island[data-ready='true'] {
    opacity: 1;
  }
  .forest-island :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
</style>
