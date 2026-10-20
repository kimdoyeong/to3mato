<script lang="ts">
  const icons: Record<string, string> = {
    camera:
      '<rect x="3" y="6" width="18" height="15" rx="3"/><path d="m8 6 2-3h4l2 3"/><circle cx="12" cy="13" r="4"/>',
    todo: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 9 1 1 2-2m3 1h3m-9 6 1 1 2-2m3 1h3"/>',
    folder:
      '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m6 0h1"/>',
    settings:
      '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/>',
    play: '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14m8-14v14" stroke-width="3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    leaf: '<path d="M20 3C8 2 2 9 5 16s15 5 15-13ZM4 21 16 9"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    book: '<path d="M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
    cup: '<path d="M5 6h12v9a5 5 0 0 1-10 0V6m10 2h2a3 3 0 0 1 0 6h-2M3 22h18M9 1v2m5-2v2"/>',
  };
  let { name }: { name: string } = $props();
</script>

<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"
  >{@html icons[name] || icons.folder}</svg
>
