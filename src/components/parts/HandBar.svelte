<script lang="ts">
  let {
    value = 0,
    color = 'var(--tomato)',
    track = '#fff',
    label,
    class: className = '',
  }: {
    value?: number;
    color?: string;
    track?: string;
    label?: string;
    class?: string;
  } = $props();
  // pathLength="100"으로 선 길이를 100으로 고정하고 dasharray로 채운 비율만 그린다.
  const percent = $derived(
    Math.round(Math.max(0, Math.min(1, value || 0)) * 100),
  );
  const d = 'M3 8c40-3 78 3 117-1s78 2 117-1';
</script>

<svg
  class="handbar {className}"
  viewBox="0 0 240 14"
  preserveAspectRatio="none"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <path
    {d}
    fill="none"
    stroke={track}
    stroke-width="6"
    stroke-linecap="round"
  />
  <path
    {d}
    fill="none"
    stroke={color}
    stroke-width="5"
    stroke-linecap="round"
    pathLength="100"
    stroke-dasharray="{percent} 100"
  />
</svg>
