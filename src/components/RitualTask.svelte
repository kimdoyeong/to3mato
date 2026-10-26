<script lang="ts">
  import { state as appState, send } from '../lib/client';
  import type { Task } from '../lib/types';
  import Tomato from './Tomato.svelte';
  let {
    task,
    targetDate,
    mode,
  }: { task: Task; targetDate: string; mode: 'carry' | 'backlog' | 'review' } =
    $props();
  let busy = $state(false);
  let project = $derived($appState.projects.find((p) => p.id === task.project));
  async function act(type: string, date?: string) {
    if (busy) return;
    busy = true;
    await send(type, { id: task.id, ...(date !== undefined ? { date } : {}) });
    busy = false;
  }
</script>

<div class="paper flat ritual-task" class:backlog={mode !== 'carry'}>
  <div class="ritual-task-title">
    <span>{task.title}</span>{#if project}<span class="chip"
        >{project.name}</span
      >{/if}
  </div>
  <span class="pomo-count" aria-label={`처음 예상 ${task.estimate}`}
    >{task.estimate}<Tomato /></span
  >
  <div class="ritual-task-actions">
    <button
      class="btn-line"
      disabled={busy}
      onclick={() => act('task:move', targetDate)}
      >{mode === 'carry'
        ? '오늘로'
        : mode === 'review'
          ? '내일로'
          : '오늘에 배치'}</button
    >
    {#if mode !== 'backlog'}
      <button
        class="btn-text"
        disabled={busy}
        onclick={() => act('task:move', '')}>보관</button
      >
      <button
        class="btn-text"
        disabled={busy}
        onclick={() => act(mode === 'carry' ? 'task:delete' : 'task:toggle')}
        >{mode === 'carry' ? '삭제' : '완료'}</button
      >
    {/if}
  </div>
</div>
