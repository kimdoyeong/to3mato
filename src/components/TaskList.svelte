<script lang="ts">
  import Icon from './Icon.svelte';
  import Pomodoros from './Pomodoros.svelte';
  import EstimatePicker from './EstimatePicker.svelte';
  import Circ from './parts/Circ.svelte';
  import { state as appState, send, notify } from '../lib/client';
  import { localDate, dateLabel, usedPomodoros } from '../lib/domain.mjs';
  import type { Task } from '../lib/types';
  let {
    tasks,
    onedit,
    ordered = false,
    backlog = false,
    showDate = true,
  }: {
    tasks: Task[];
    onedit: (task: Task) => void;
    /** Today's list: numbered rows that can be dragged into a new order. */
    ordered?: boolean;
    /** Unscheduled list: rows offer to place the task on today. */
    backlog?: boolean;
    showDate?: boolean;
  } = $props();
  let over = $state<string | null>(null);
  async function toggle(task: Task) {
    if (await send('task:toggle', { id: task.id }))
      notify(task.done ? '완료를 취소했습니다.' : '할 일을 완료했습니다.');
  }
  async function setEstimate(task: Task, estimate: number) {
    if (estimate === task.estimate) return;
    await send('task:save', {
      id: task.id,
      title: task.title,
      estimate,
      date: task.date,
      project: task.project,
    });
  }
  async function placeToday(task: Task) {
    if (await send('task:move', { id: task.id, date: localDate() }))
      notify('예정일을 변경했습니다.');
  }
  function drag(event: DragEvent, id: string) {
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  async function drop(event: DragEvent, target: Task) {
    over = null;
    const id = event.dataTransfer?.getData('text/plain');
    if (!ordered || !id || id === target.id) return;
    // The section handler still runs and moves the date when it differs.
    await send('task:reorder', { id, before: target.id });
  }
</script>

<div class="task-list">
  {#each tasks as task, index (task.id)}
    {@const project = $appState.projects.find((p) => p.id === task.project)}
    {@const used = usedPomodoros($appState, task.id)}
    {@const current =
      $appState.timer?.phase !== 'rest' && $appState.timer?.taskId === task.id}
    <article
      class="task-row paper"
      class:alt={index % 2 === 1}
      class:done={task.done}
      class:current
      class:drag-over={over === task.id}
      draggable="true"
      ondragstart={(event) => drag(event, task.id)}
      ondragover={(event) => {
        if (!ordered) return;
        event.preventDefault();
        over = task.id;
      }}
      ondragleave={() => {
        if (over === task.id) over = null;
      }}
      ondrop={(event) => drop(event, task)}
    >
      {#if ordered}
        <span class="handle" aria-hidden="true"><Icon name="grip" /></span>
        <button
          class="circ-button"
          onclick={() => toggle(task)}
          aria-label={`${task.title} ${task.done ? '완료 취소' : '완료'}`}
          ><Circ
            n={task.done ? 'check' : index + 1}
            state={task.done ? 'ok' : current ? 'on' : ''}
          /></button
        >
      {:else}
        <button
          class="check"
          class:checked={task.done}
          onclick={() => toggle(task)}
          aria-label={`${task.title} ${task.done ? '완료 취소' : '완료'}`}
          >{#if task.done}<Icon name="check" />{/if}</button
        >
      {/if}
      <button class="task-detail" onclick={() => onedit(task)}
        ><span class="task-title" class:strike={task.done}>{task.title}</span
        ><span class="task-meta"
          ><span class="chip"
            >{#if project}<i
                class="project-dot"
                style:background={project.color}
              ></i>{project.name}{:else}프로젝트 없음{/if}</span
          >{#if showDate}<span class="task-date"
              >{task.date === localDate()
                ? '오늘'
                : task.date
                  ? dateLabel(task.date).split(' ').slice(0, 2).join(' ')
                  : '날짜 미지정'}</span
            >{/if}</span
        ></button
      >
      <span class="task-estimate"
        ><span class="muted">예상</span><EstimatePicker
          value={task.estimate}
          locked={task.done || used > 0}
          label={`${task.title} 예상 포모도로`}
          onchange={(value) => setEstimate(task, value)}
        /></span
      >
      <Pomodoros estimate={task.estimate} actual={used} />
      {#if backlog && !task.done}
        <button class="btn-line" onclick={() => placeToday(task)}
          >오늘에 배치</button
        >
      {/if}
      <button
        class="task-more"
        onclick={() => onedit(task)}
        aria-label={`${task.title} 수정`}><Icon name="more" /></button
      >
    </article>
  {:else}<div class="empty">등록된 할 일이 없습니다.</div>{/each}
</div>
