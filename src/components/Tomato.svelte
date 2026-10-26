<script lang="ts">
  type Variant = 'empty' | 'plan' | 'filled' | 'half' | 'over';
  type Size = 'xs' | 'sm' | 'lg' | 'xl';
  let {
    filled = false,
    variant,
    size,
    class: className = '',
  }: {
    filled?: boolean;
    variant?: Variant;
    size?: Size;
    class?: string;
  } = $props();
  // variant가 없으면 기존 filled 불리언을 그대로 따른다.
  const state = $derived<Variant>(variant ?? (filled ? 'filled' : 'empty'));
</script>

<svg
  class="mini-tomato tomato {state === 'empty' ? '' : state} {size ??
    ''} {className}"
  viewBox="0 0 24 24"
  aria-hidden="true"
  ><path
    class="body"
    d="M12 7C7 4.5 2 8 2.5 13.5 3 18.5 7 22 12 22s9-3.5 9.5-8.5C22 8 17 4.5 12 7Z"
  /><path
    class="calyx"
    d="m12 8.5-4.4-.4 2-2-2.8-1.2 3-.4.4-2.2L12 4l1.8-1.7.4 2.2 3 .4-2.8 1.2 2 2Z"
  /></svg
>
