<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  let {
    tilt,
    tone = 'paper',
    tape,
    tapeColor = 'yellow',
    alt = false,
    class: className = '',
    children,
    ...rest
  }: {
    tilt?: 'a' | 'b' | 'c';
    tone?: 'paper' | 'peach' | 'butter' | 'done' | 'current';
    tape?: 'center' | 'left' | 'right';
    tapeColor?: 'yellow' | 'pink' | 'green';
    alt?: boolean;
    class?: string;
    children?: Snippet;
  } & HTMLAttributes<HTMLDivElement> = $props();
  const tapeSide = { center: '', left: 'l', right: 'r' };
  const tapeTone = { yellow: '', pink: 'pink', green: 'green' };
</script>

<div
  class="paper {tone === 'paper' ? '' : tone} {alt ? 'alt' : ''} {tilt
    ? `tilt-${tilt}`
    : ''} {className}"
  {...rest}
>
  {#if tape}<span
      class="tape {tapeSide[tape]} {tapeTone[tapeColor]}"
      aria-hidden="true"
    ></span>{/if}
  {@render children?.()}
</div>
