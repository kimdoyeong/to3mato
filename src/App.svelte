<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    state as appState,
    now,
    ready,
    loadError,
    message,
    initialize,
    send,
    notify,
  } from './lib/client';
  import { localDate, MAX_TASK_ESTIMATE } from './lib/domain.mjs';
  import type { Task } from './lib/types';
  import Icon from './components/Icon.svelte';
  import TodoView from './components/TodoView.svelte';
  import ProjectsView from './components/ProjectsView.svelte';
  import CalendarView from './components/CalendarView.svelte';
  import SettingsView from './components/SettingsView.svelte';
  import ExecutionPanel from './components/ExecutionPanel.svelte';
  import BatchTaskDialog from './components/BatchTaskDialog.svelte';
  import CaptureMoment from './components/CaptureMoment.svelte';
  import FocusLog from './components/FocusLog.svelte';
  import DeliveryNotice from './components/DeliveryNotice.svelte';
  let batchDialog: { open: (id: string) => Promise<void> };
  let projectEntry = $state(false);
  let selectedProject = $state<string | null>(null);
  let calendarDate = $state(localDate()),
    calendarWeek = $state(0);
  let taskError = $state(''),
    projectError = $state('');
  let tab = $state('todo'),
    taskDialog: HTMLDialogElement,
    projectDialog: HTMLDialogElement;
  let editing = $state<string | null>(null),
    title = $state(''),
    estimate = $state(1),
    date = $state(''),
    project = $state(''),
    projectName = $state(''),
    busy = $state(false);
  let originalEstimate = $state(1);
  const tabs = [
    ['todo', '할 일', 'todo'],
    ['projects', '프로젝트', 'folder'],
    ['calendar', '캘린더', 'calendar'],
    ['log', '집중 로그', 'camera'],
    ['settings', '설정', 'settings'],
  ];
  onMount(() => {
    let disposed = false,
      cleanup: (() => void) | undefined;
    initialize().then((fn) => {
      if (disposed) fn();
      else cleanup = fn;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  });
  async function openTask(
    task: Task | null = null,
    assignedDate = localDate(),
    assignedProject = '',
  ) {
    taskError = '';
    projectEntry = !task && !!assignedProject;
    editing = task?.id || null;
    title = task?.title || '';
    estimate = task?.estimate || 1;
    originalEstimate = estimate;
    date = task ? task.date : assignedDate;
    project = task?.project || assignedProject;
    await tick();
    taskDialog.showModal();
    taskDialog.querySelector<HTMLInputElement>('input')?.focus();
  }
  async function saveTask(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    taskError = '';
    if (!title.trim()) {
      taskError = '할 일 이름을 입력하세요.';
      taskDialog.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    busy = true;
    const success = await send('task:save', {
      id: editing,
      title,
      estimate: Number(estimate),
      date,
      project,
    });
    busy = false;
    if (success) {
      taskDialog.close();
      notify(editing ? '할 일을 수정했습니다.' : '할 일을 추가했습니다.');
    } else taskError = $message || '저장하지 못했습니다. 다시 시도하세요.';
  }
  async function deleteTask() {
    if (!editing || busy) return;
    busy = true;
    const success = await send('task:delete', { id: editing });
    busy = false;
    if (success) {
      taskDialog.close();
      notify('할 일을 삭제했습니다. 집중 기록은 유지됩니다.');
    } else taskError = $message || '삭제하지 못했습니다. 다시 시도하세요.';
  }
  async function openProject() {
    projectName = '';
    projectError = '';
    await tick();
    projectDialog.showModal();
    projectDialog.querySelector<HTMLInputElement>('input')?.focus();
  }
  async function addProject(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    projectError = '';
    if (!projectName.trim()) {
      projectError = '프로젝트 이름을 입력하세요.';
      projectDialog.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    busy = true;
    const success = await send('project:save', { name: projectName });
    busy = false;
    if (success) {
      projectDialog.close();
      notify('프로젝트를 추가했습니다.');
    } else projectError = $message || '저장하지 못했습니다. 다시 시도하세요.';
  }
</script>

{#if $loadError}<main class="startup">
    <p role="alert">{$loadError}</p>
    <button class="primary" onclick={() => location.reload()}>다시 시도</button>
  </main>
{:else if !$ready}<main class="startup">데이터 불러오는 중</main>
{:else}<main class="app">
    <div class="work-shell">
      <nav class="tabs" aria-label="작업 영역 탭">
        {#each tabs as [id, label, icon]}<button
            class="tab"
            class:active={tab === id}
            aria-current={tab === id ? 'page' : undefined}
            onclick={() => (tab = id)}><Icon name={icon} />{label}</button
          >{/each}
      </nav>
      <section class="workspace" aria-label="작업 영역">
        <div class="workspace-heading">
          <span id="date-label"
            >{new Date($now).toLocaleDateString('ko-KR', {
              month: 'long',
              day: 'numeric',
              weekday: 'short',
            })}</span
          >
        </div>
        {#if tab === 'todo'}<TodoView
            onedit={(task) => openTask(task)}
            onadd={(date) => openTask(null, date)}
          />
        {:else if tab === 'projects'}<ProjectsView
            bind:selected={selectedProject}
            onedit={(task) => openTask(task)}
            onadd={(id) => openTask(null, localDate(), id)}
            onproject={openProject}
          />
        {:else if tab === 'calendar'}<CalendarView
            bind:selected={calendarDate}
            bind:week={calendarWeek}
            onedit={(task) => openTask(task)}
            onadd={(date) => openTask(null, date)}
          />
        {:else if tab === 'log'}<FocusLog />
        {:else}<SettingsView />{/if}
      </section>
    </div>
    <ExecutionPanel />
  </main>{/if}
<dialog
  bind:this={taskDialog}
  aria-labelledby="task-dialog-title"
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
>
  <form onsubmit={saveTask}>
    <div class="dialog-heading">
      <h2 id="task-dialog-title">{editing ? '할 일 수정' : '할 일 추가'}</h2>
      <button
        type="button"
        class="icon-button"
        disabled={busy}
        onclick={() => taskDialog.close()}
        aria-label="닫기">✕</button
      >
    </div>
    {#if projectEntry}<div class="add-mode">
        <button type="button" class="selected" aria-pressed="true"
          >하나 추가</button
        ><button
          type="button"
          disabled={busy}
          onclick={() => {
            taskDialog.close();
            batchDialog.open(project);
          }}>여러 개 추가</button
        >
      </div>{/if}
    <label
      >할 일 이름<input
        disabled={busy}
        aria-invalid={!!taskError && !title.trim()}
        aria-describedby={taskError ? 'task-error' : undefined}
        oninput={() => (taskError = '')}
        bind:value={title}
        required
        maxlength="120"
        placeholder="예: 강의 수강 및 정리"
        autocomplete="off"
      /></label
    >
    <div class="form-grid">
      <label
        >예상 포모도로<select disabled={busy} bind:value={estimate}
          >{#each Array.from({ length: MAX_TASK_ESTIMATE }, (_, i) => i + 1) as value}<option
              {value}>{value} 포모도로</option
            >{/each}
          {#if originalEstimate > MAX_TASK_ESTIMATE}<option
              value={originalEstimate}>{originalEstimate} 포모도로</option
            >{/if}</select
        ></label
      ><label
        >예정일<input disabled={busy} type="date" bind:value={date} /></label
      >
    </div>
    <label
      >프로젝트<select disabled={busy} bind:value={project}
        ><option value="">프로젝트 없음</option
        >{#each $appState.projects as item}<option value={item.id}
            >{item.name}</option
          >{/each}</select
      ></label
    >
    {#if taskError}<p id="task-error" class="form-error" role="alert">
        {taskError}
      </p>{/if}
    <div class="dialog-footer">
      {#if editing}<button
          class="text-button"
          type="button"
          onclick={deleteTask}
          disabled={busy}>삭제</button
        >{/if}<button class="primary" type="submit" disabled={busy}>저장</button
      >
    </div>
  </form>
</dialog>
<dialog
  bind:this={projectDialog}
  aria-labelledby="project-dialog-title"
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
>
  <form onsubmit={addProject}>
    <div class="dialog-heading">
      <h2 id="project-dialog-title">프로젝트 추가</h2>
      <button
        class="icon-button"
        type="button"
        disabled={busy}
        onclick={() => projectDialog.close()}
        aria-label="닫기">✕</button
      >
    </div>
    <label
      >프로젝트 이름<input
        disabled={busy}
        aria-invalid={!!projectError && !projectName.trim()}
        aria-describedby={projectError ? 'project-error' : undefined}
        oninput={() => (projectError = '')}
        bind:value={projectName}
        required
        maxlength="80"
        autocomplete="off"
      /></label
    >
    {#if projectError}<p id="project-error" class="form-error" role="alert">
        {projectError}
      </p>{/if}
    <div class="dialog-footer">
      <button class="primary" type="submit" disabled={busy}>저장</button>
    </div>
  </form>
</dialog>
<div class="toast" class:visible={!!$message} role="status">{$message}</div>

<BatchTaskDialog
  bind:this={batchDialog}
  onsingle={(id) => openTask(null, localDate(), id)}
/>
{#if $ready}<CaptureMoment /><DeliveryNotice
    onopen={() => (tab = 'log')}
  />{/if}
