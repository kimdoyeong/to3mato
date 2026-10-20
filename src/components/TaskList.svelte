<script lang="ts">
  import Icon from './Icon.svelte';
  import Pomodoros from './Pomodoros.svelte';
  import { state as appState, send, notify } from '../lib/client';
  import { localDate, dateLabel } from '../lib/domain.mjs';
  import type { Task } from '../lib/types';
  let { tasks, onedit }: { tasks: Task[]; onedit: (task: Task) => void } =
    $props();
  async function toggle(task: Task) {
    if (await send('task:toggle', { id: task.id }))
      notify(task.done ? '완료를 취소했습니다.' : '할 일을 완료했습니다.');
  }
  function drag(event: DragEvent, id: string) {
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
</script>

<div class="task-list">
  {#each tasks as task (task.id)}
    {@const project = $appState.projects.find((p) => p.id === task.project)}
    <article
      class="task-row"
      class:done={task.done}
      class:current={$appState.timer?.phase === 'focus' &&
        $appState.timer.taskId === task.id}
      draggable="true"
      ondragstart={(event) => drag(event, task.id)}
    >
      <button
        class="check"
        class:checked={task.done}
        onclick={() => toggle(task)}
        aria-label={`${task.title} ${task.done ? '완료 취소' : '완료'}`}
        >{#if task.done}<Icon name="check" />{/if}</button
      >
      <button class="task-detail" onclick={() => onedit(task)}
        ><span class="task-title">{task.title}</span><span class="task-meta"
          ><span
            >{#if project}<i
                class="project-dot"
                style:background={project.color}
              ></i>{project.name}{:else}프로젝트 없음{/if}</span
          ><span>·</span><span
            >{task.date === localDate()
              ? '오늘'
              : task.date
                ? dateLabel(task.date).split(' ').slice(0, 2).join(' ')
                : '날짜 미지정'}</span
          ></span
        ></button
      >
      <Pomodoros
        estimate={task.estimate}
        actual={$appState.records
          .filter((r) => r.taskId === task.id)
          .reduce((sum, r) => sum + r.pomodoros, 0)}
      />
      <button
        class="task-more"
        onclick={() => onedit(task)}
        aria-label={`${task.title} 수정`}><Icon name="more" /></button
      >
    </article>
  {:else}<div class="empty">등록된 할 일이 없습니다.</div>{/each}
</div>
