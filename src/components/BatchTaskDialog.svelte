<script lang="ts">
  import { tick } from 'svelte';
  import { state as appState, send, notify, message } from '../lib/client';
  import { localDate, MAX_TASK_ESTIMATE } from '../lib/domain.mjs';
  import {
    generateTaskBatch,
    renderTaskTemplate,
    MAX_BATCH_SIZE,
  } from '../lib/batch.mjs';
  import TemplateBatch from './TemplateBatch.svelte';
  import TemplateInput from './TemplateInput.svelte';
  let { onsingle }: { onsingle: (project: string) => void } = $props();
  let dialog: HTMLDialogElement;
  let mode = $state<'batch' | 'template'>('batch');
  let templateDate = $state('');
  let project = $state(''),
    template = $state(''),
    count = $state<number | undefined>(10),
    estimate = $state<number | undefined>(1),
    startDate = $state(localDate()),
    perDay = $state<number | undefined>(2);
  let weekdays = $state<number[]>([1, 3, 5]),
    overrides = $state<Record<number, number | undefined>>({});
  let drafts = $state<
    { title: string; estimate: number; date: string; edited: boolean }[]
  >([]);
  let step = $state<'setup' | 'review'>('setup'),
    error = $state(''),
    busy = $state(false);
  const days = [
    { id: 1, name: '월' },
    { id: 2, name: '화' },
    { id: 3, name: '수' },
    { id: 4, name: '목' },
    { id: 5, name: '금' },
    { id: 6, name: '토' },
    { id: 0, name: '일' },
  ];
  export async function open(
    id: string,
    nextMode: 'batch' | 'template' = 'batch',
    date = '',
  ) {
    mode = nextMode;
    templateDate = date;
    project = id;
    template = '';
    count = 10;
    estimate = 1;
    startDate = localDate();
    perDay = 2;
    weekdays = [1, 3, 5];
    overrides = {};
    drafts = [];
    step = 'setup';
    error = '';
    busy = false;
    await tick();
    dialog.showModal();
    dialog
      .querySelector<HTMLInputElement>(
        mode === 'template' ? '.template-form input' : '#batch-template',
      )
      ?.focus();
  }
  async function generate(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      drafts = generateTaskBatch({
        template,
        count,
        estimate,
        startDate,
        weekdays,
        perDay,
        overrides,
      }).map((draft) => ({ ...draft, edited: false }));
      step = 'review';
      await tick();
      dialog.querySelector<HTMLInputElement>('.batch-review input')?.focus();
    } catch (problem) {
      error =
        problem instanceof Error ? problem.message : '입력 내용을 확인하세요.';
    }
  }
  function updateDate(index: number, date: string) {
    drafts[index].date = date;
    if (!drafts[index].edited)
      drafts[index].title = renderTaskTemplate(template, index + 1, date);
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    const success = await send('task:batch', {
      project,
      tasks: drafts.map(({ title, estimate, date }) => ({
        title,
        estimate,
        date,
      })),
    });
    busy = false;
    if (success) {
      dialog.close();
      notify(`${drafts.length}개의 할 일을 추가했습니다.`);
    } else {
      error = $message || '할 일을 추가하지 못했습니다. 다시 시도하세요.';
    }
  }
</script>

<dialog
  class="batch-dialog"
  bind:this={dialog}
  aria-labelledby="batch-title"
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
>
  <div class="dialog-heading">
    <div>
      <h2 id="batch-title">여러 할 일 추가</h2>
      <p class="batch-help">
        {$appState.projects.find((item) => item.id === project)?.name}
      </p>
    </div>
    <button
      type="button"
      class="icon-button"
      disabled={busy}
      onclick={() => dialog.close()}
      aria-label="닫기">✕</button
    >
  </div>
  {#if step === 'setup' || mode === 'template'}
    <div class="add-mode">
      <button
        type="button"
        onclick={() => {
          dialog.close();
          onsingle(project);
        }}>하나 추가</button
      ><button
        type="button"
        class:selected={mode === 'batch'}
        aria-pressed={mode === 'batch'}
        disabled={busy}
        onclick={() => (mode = 'batch')}>여러 개 추가</button
      >
      <button
        type="button"
        class:selected={mode === 'template'}
        aria-pressed={mode === 'template'}
        disabled={busy}
        onclick={() => (mode = 'template')}>템플릿</button
      >
    </div>
    {#if mode === 'template'}
      <TemplateBatch
        bind:project
        date={templateDate}
        onclose={() => dialog.close()}
        onbusy={(value) => (busy = value)}
      />
    {:else}
      <form onsubmit={generate} class="batch-form">
        <div class="batch-scroll">
          <TemplateInput bind:value={template} />
          <div class="form-grid">
            <label
              >생성 개수<input
                type="number"
                min="1"
                max={MAX_BATCH_SIZE}
                step="1"
                required
                bind:value={count}
              /></label
            ><label
              >공통 예상 포모도로<input
                type="number"
                min="1"
                max={MAX_TASK_ESTIMATE}
                step="1"
                required
                bind:value={estimate}
              /></label
            >
          </div>
          <div class="form-grid">
            <label
              >시작 날짜<input
                type="date"
                required
                bind:value={startDate}
              /></label
            ><label
              >하루 기본 개수<input
                type="number"
                min="1"
                max={MAX_BATCH_SIZE}
                step="1"
                required
                bind:value={perDay}
              /></label
            >
          </div>
          <fieldset class="weekday-field">
            <legend>배치할 요일</legend>
            <div class="weekday-picker">
              {#each days as day}<button
                  type="button"
                  class:selected={weekdays.includes(day.id)}
                  aria-pressed={weekdays.includes(day.id)}
                  aria-label={`${day.name}요일 배치`}
                  onclick={() => {
                    weekdays = weekdays.includes(day.id)
                      ? weekdays.filter((id) => id !== day.id)
                      : [...weekdays, day.id];
                  }}>{day.name}</button
                >{/each}
            </div>
          </fieldset>
          <fieldset class="weekday-field">
            <legend>요일별 개수 예외</legend>
            <p class="batch-help">비워두면 하루 기본 개수를 적용합니다.</p>
            <div class="weekday-overrides">
              {#each days.filter( (day) => weekdays.includes(day.id) ) as day}<label
                  >{day.name}요일<input
                    type="number"
                    min="1"
                    max={MAX_BATCH_SIZE}
                    step="1"
                    placeholder={String(perDay ?? '')}
                    bind:value={overrides[day.id]}
                  /></label
                >{/each}
            </div>
          </fieldset>
          {#if drafts.length}<p class="batch-help">
              목록을 다시 생성하면 개별 수정한 내용이 초기화됩니다.
            </p>{/if}
          {#if error}<p class="batch-error" role="alert">{error}</p>{/if}
        </div>
        <div class="dialog-footer">
          <span class="batch-help">1번부터 생성 · 최대 {MAX_BATCH_SIZE}개</span
          ><button type="submit" class="primary"
            >{drafts.length ? '목록 다시 생성' : '목록 생성'}</button
          >
        </div>
      </form>
    {/if}
  {:else}
    <form onsubmit={save} class="batch-form">
      <p class="batch-help">
        {drafts.length}개 · 이름과 예정일 및 포모도로를 수정한 뒤 추가하세요.
      </p>
      <div class="batch-scroll batch-review">
        <table>
          <thead
            ><tr
              ><th scope="col">번호</th><th scope="col">할 일 이름</th><th
                scope="col">포모도로</th
              ><th scope="col">예정일</th></tr
            ></thead
          ><tbody
            >{#each drafts as draft, index}<tr
                ><td>{index + 1}</td><td
                  ><input
                    aria-label={`${index + 1}번 할 일 이름`}
                    bind:value={draft.title}
                    oninput={() => (draft.edited = true)}
                    required
                    maxlength="120"
                    disabled={busy}
                  /></td
                ><td
                  ><input
                    aria-label={`${index + 1}번 예상 포모도로`}
                    type="number"
                    min="1"
                    max={MAX_TASK_ESTIMATE}
                    step="1"
                    bind:value={draft.estimate}
                    required
                    disabled={busy}
                  /></td
                ><td
                  ><input
                    aria-label={`${index + 1}번 예정일`}
                    type="date"
                    value={draft.date}
                    onchange={(event) =>
                      updateDate(index, event.currentTarget.value)}
                    required
                    disabled={busy}
                  /></td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>
      {#if error}<p class="batch-error" role="alert">{error}</p>{/if}
      <div class="dialog-footer">
        <button
          type="button"
          class="secondary"
          disabled={busy}
          onclick={async () => {
            step = 'setup';
            error = '';
            await tick();
            dialog.querySelector<HTMLInputElement>('#batch-template')?.focus();
          }}>설정 수정</button
        ><button type="submit" class="primary" disabled={busy}
          >{busy ? '추가 중' : `${drafts.length}개 추가`}</button
        >
      </div>
    </form>
  {/if}
</dialog>
