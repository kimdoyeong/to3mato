<script lang="ts">
  import { untrack } from 'svelte';
  import { state as appState, send, message } from '../lib/client';
  import { generateTemplateBatch } from '../lib/templates.mjs';
  import { localDate } from '../lib/domain.mjs';
  import type { Template, TemplateStep } from '../lib/types';
  import Tomato from './Tomato.svelte';
  import WeekdayPicker from './WeekdayPicker.svelte';
  let {
    project = $bindable(''),
    date = '',
    onclose,
    onbusy,
  }: {
    project: string;
    date?: string;
    onclose: () => void;
    onbusy: (value: boolean) => void;
  } = $props();
  let selected = $state('');
  let name = $state('');
  let steps = $state<TemplateStep[]>([{ title: '', estimate: 1 }]);
  let count = $state(1);
  let startDate = $state(untrack(() => date || localDate()));
  let weekdays = $state([1, 2, 3, 4, 5]);
  let busy = $state(false),
    error = $state('');
  const preview = $derived.by(() => {
    try {
      return {
        tasks: generateTemplateBatch({ steps, count, startDate, weekdays }),
        error: '',
      };
    } catch (e) {
      return { tasks: [], error: e instanceof Error ? e.message : '' };
    }
  });
  function select(item?: Template) {
    selected = item?.id ?? '';
    name = item?.name ?? '';
    steps = item
      ? item.steps.map((s) => ({ ...s }))
      : [{ title: '', estimate: 1 }];
    error = '';
  }
  async function saveTemplate() {
    if (busy) return;
    busy = true;
    onbusy(true);
    error = '';
    const previous = new Set($appState.templates.map((t) => t.id));
    const success = await send('template:save', {
      id: selected || undefined,
      name,
      steps: steps.map(({ title, estimate }) => ({ title, estimate })),
    });
    if (success && !selected)
      selected = $appState.templates.find((t) => !previous.has(t.id))?.id ?? '';
    if (!success) error = $message;
    busy = false;
    onbusy(false);
  }
  async function generate(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    if (preview.error) {
      error = preview.error;
      return;
    }
    busy = true;
    onbusy(true);
    error = '';
    const success = await send('task:batch', { project, tasks: preview.tasks });
    busy = false;
    onbusy(false);
    if (success) onclose();
    else error = $message;
  }
</script>

<div class="template-layout">
  <aside class="template-list" aria-label="템플릿">
    {#each $appState.templates as item (item.id)}
      <button
        type="button"
        class="tpl"
        class:on={selected === item.id}
        aria-pressed={selected === item.id}
        disabled={busy}
        onclick={() => select(item)}>{item.name}</button
      >
    {/each}
    <button
      type="button"
      class="btn-dash"
      disabled={busy}
      onclick={() => select()}>템플릿 추가</button
    >
  </aside>
  <form class="batch-form template-form" onsubmit={generate}>
    <div class="batch-scroll">
      <fieldset disabled={busy} class="template-fields">
        <label>템플릿 이름<input bind:value={name} maxlength="80" /></label>
        <div class="template-steps">
          {#each steps as step, index}
            <div class="template-step">
              <span class="num">{index + 1}</span>
              <input
                aria-label={`단계 ${index + 1}`}
                bind:value={step.title}
                maxlength="120"
                required
              />
              <div class="seg" role="group" aria-label="예상 포모도로">
                {#each [1, 2] as value}<button
                    type="button"
                    class="seg-b"
                    class:on={step.estimate === value}
                    aria-label={String(value)}
                    aria-pressed={step.estimate === value}
                    onclick={() => (step.estimate = value)}
                    >{value}<Tomato filled /></button
                  >{/each}
              </div>
              <button
                type="button"
                class="btn-text"
                aria-label={`단계 ${index + 1} 삭제`}
                disabled={steps.length === 1}
                onclick={() => (steps = steps.filter((_, i) => i !== index))}
                >삭제</button
              >
            </div>
          {/each}
        </div>
        <button
          type="button"
          class="btn-dash"
          disabled={steps.length >= 20}
          onclick={() => (steps = [...steps, { title: '', estimate: 1 }])}
          >단계 추가</button
        >
        <div class="form-grid template-schedule">
          <div class="field">
            <span>회차</span>
            <div class="ritual-stepper">
              <button
                type="button"
                class="step"
                aria-label="회차 −"
                disabled={count <= 1}
                onclick={() => count--}>−</button
              >
              <input
                type="number"
                aria-label="회차"
                min="1"
                max={Math.floor(500 / steps.length)}
                required
                bind:value={count}
              />
              <button
                type="button"
                class="step"
                aria-label="회차 +"
                disabled={count >= Math.floor(500 / steps.length)}
                onclick={() => count++}>+</button
              >
            </div>
          </div>
          <label
            >시작일<input type="date" required bind:value={startDate} /></label
          >
        </div>
        <WeekdayPicker
          value={weekdays}
          onchange={(value) => (weekdays = value)}
        />
        <label
          >프로젝트<select bind:value={project}
            ><option value="">프로젝트 없음</option
            >{#each $appState.projects as item}<option value={item.id}
                >{item.name}</option
              >{/each}</select
          ></label
        >
      </fieldset>
      <div class="paper alt template-preview" aria-live="polite">
        <div class="template-totals">
          <span>생성될 할 일 <b class="num">{preview.tasks.length}</b></span
          ><span
            >예상 합계 <b class="num"
              >{preview.tasks.reduce((sum, t) => sum + t.estimate, 0)}</b
            ><Tomato filled /></span
          >
        </div>
        {#each preview.tasks.slice(0, 4) as task}<div class="ritual-row">
            <span>{task.title}</span><time>{task.date}</time><span
              class="pomo-count">{task.estimate}<Tomato filled /></span
            >
          </div>{/each}
        {#if preview.tasks.length > 4}<p class="muted">
            외 {preview.tasks.length - 4}개
          </p>{/if}
      </div>
      {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    </div>
    <div class="dialog-footer">
      <button
        type="button"
        class="btn-line"
        disabled={busy || !name.trim() || steps.some((s) => !s.title.trim())}
        onclick={saveTemplate}>템플릿으로 저장</button
      >
      <button class="primary" type="submit" disabled={busy}>저장</button>
    </div>
  </form>
</div>
