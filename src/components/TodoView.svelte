<script lang="ts">
  import TaskList from './TaskList.svelte';
  import Icon from './Icon.svelte';
  import { state as appState, now, send, notify } from '../lib/client';
  import { getTodoSections, localDate } from '../lib/domain.mjs';
  import type { Task } from '../lib/types';
  let {
    onedit,
    onadd,
  }: { onedit: (task: Task) => void; onadd: (date: string) => void } = $props();
  let dragging = $state<string | null>(null);
  let today = $derived(localDate(new Date($now)));
  let sections = $derived(getTodoSections($appState.tasks, today));
  async function drop(event: DragEvent, date: string) {
    event.preventDefault();
    dragging = null;
    const id = event.dataTransfer?.getData('text/plain');
    if (id && (await send('task:move', { id, date })))
      notify('예정일을 변경했습니다.');
  }
</script>

<div class="todo-sections">
  {#each sections as section (section.date)}
    <section
      class="todo-section"
      class:drag-over={dragging === section.date}
      aria-label={section.label}
      ondragover={(event) => {
        event.preventDefault();
        dragging = section.date;
      }}
      ondragleave={() => (dragging = null)}
      ondrop={(event) => drop(event, section.date)}
    >
      <div class="todo-section-heading">
        <h2>{section.label}</h2>
        <span class="section-task-count">{section.tasks.length}</span>
      </div>
      {#if section.tasks.length}<TaskList tasks={section.tasks} {onedit} />{/if}
      <button
        class="section-add"
        onclick={() => onadd(section.date)}
        aria-label={`${section.label} 할 일 추가`}
        ><Icon name="plus" />할 일 추가</button
      >
    </section>
  {/each}
</div>
