<script lang="ts">
  let { filled = false }: { filled?: boolean } = $props();
</script>

<svg class="mini-tomato" class:filled viewBox="0 0 24 24" aria-hidden="true"
  ><path
    class="body"
    d="M12 7C7 4.5 2 8 2.5 13.5 3 18.5 7 22 12 22s9-3.5 9.5-8.5C22 8 17 4.5 12 7Z"
  /><path
    class="calyx"
    d="m12 8.5-4.4-.4 2-2-2.8-1.2 3-.4.4-2.2L12 4l1.8-1.7.4 2.2 3 .4-2.8 1.2 2 2Z"
  /></svg
>
