<script lang="ts">
  import { tokenizeTemplate } from '../lib/batch.mjs';
  let { value = $bindable('') }: { value: string } = $props();
  let paint: HTMLDivElement;
  let pieces = $derived(tokenizeTemplate(value));
  let invalid = $derived(
    pieces.some(
      (piece) => piece.kind === 'invalid' || piece.kind === 'incomplete',
    ),
  );
</script>

<label for="batch-template">할 일 이름 규칙</label>
<div class="template-editor">
  <div class="template-paint" bind:this={paint} aria-hidden="true">
    {#each pieces as piece}<span class={`template-${piece.kind}`}
        >{piece.text}</span
      >{/each}
  </div>
  <input
    id="batch-template"
    aria-describedby="template-help"
    aria-invalid={invalid}
    bind:value
    required
    maxlength="120"
    placeholder="독서 (%n%) · %date%"
    autocomplete="off"
    spellcheck="false"
    onscroll={(event) => {
      paint.scrollLeft = event.currentTarget.scrollLeft;
    }}
  />
</div>
<p id="template-help" class="batch-help">
  <code>%n%</code> 번호 · <code>%date%</code> 예정일 (2026-10-19)
</p>
{#if invalid}<p class="batch-error" role="status">
    템플릿은 %n%과 %date%만 사용할 수 있습니다.
  </p>{/if}
