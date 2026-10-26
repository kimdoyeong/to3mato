<script lang="ts">
  import { getContext } from 'svelte';
  import Tomato from './Tomato.svelte';
  import Icon from './Icon.svelte';
  import { state as appState, send, notify } from '../lib/client';
  let {
    date,
    label,
    project = '',
  }: { date: string; label: string; project?: string } = $props();
  let title = $state(''),
    busy = $state(false);
  const openTemplate =
    getContext<(project: string, date: string) => void>('open-template');
  let templatesOpen = $state(false);
  async function apply(id: string) {
    if (busy) return;
    busy = true;
    if (await send('template:apply', { id, date, project }))
      templatesOpen = false;
    busy = false;
  }
  let input: HTMLInputElement;
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      notify('할 일 이름을 입력하세요.');
      input.focus();
      return;
    }
    busy = true;
    const success = await send('task:save', {
      title,
      estimate: 1,
      date,
      project,
    });
    busy = false;
    if (success) {
      title = '';
      notify('할 일을 추가했습니다.');
      input.focus();
    }
  }
</script>

<form class="quick" onsubmit={submit}>
  <Icon name="plus" />
  <input
    class="qinput"
    bind:this={input}
    bind:value={title}
    placeholder="예: 강의 수강 및 정리"
    aria-label="할 일 이름"
    maxlength="120"
    autocomplete="off"
    disabled={busy}
  />
  <button
    type="button"
    class="btn-line"
    class:pressed={templatesOpen}
    aria-expanded={templatesOpen}
    disabled={busy}
    onclick={() => (templatesOpen = !templatesOpen)}>템플릿</button
  >
  <button
    type="submit"
    class="btn-line"
    disabled={busy}
    aria-label={`${label} 할 일 추가`}>할 일 추가</button
  >
</form>

{#if templatesOpen}
  <div
    class="paper alt tilt-a quick-templates"
    role="group"
    aria-label="템플릿"
  >
    <span class="tape r" aria-hidden="true"></span>
    {#each $appState.templates as item (item.id)}
      <button
        type="button"
        class="quick-template"
        disabled={busy}
        onclick={() => apply(item.id)}
      >
        <strong>{item.name}</strong>
        <span class="template-chips"
          >{#each item.steps as step}<span class="chip"
              >{step.title.replaceAll('%n%', '1')}<span class="pomo-count"
                >{step.estimate}<Tomato filled /></span
              ></span
            >{/each}</span
        >
        <span class="muted pomo-count"
          >예상 합계 {item.steps.reduce(
            (sum, step) => sum + step.estimate,
            0,
          )}<Tomato filled /></span
        >
      </button>
    {/each}
    <button
      type="button"
      class="btn-dash"
      disabled={busy}
      onclick={() => {
        templatesOpen = false;
        openTemplate(project, date);
      }}>템플릿 추가</button
    >
  </div>
{/if}
