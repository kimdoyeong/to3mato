<script lang="ts">
  import PlanCard from './PlanCard.svelte';
  import { planOpen } from '../lib/ritual-state';
  import TaskList from './TaskList.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import CapacityRow from './parts/CapacityRow.svelte';
  import { state as appState, now, send, notify } from '../lib/client';
  import { getTodoSections, localDate } from '../lib/domain.mjs';
  import type { Task } from '../lib/types';
  let { onedit }: { onedit: (task: Task) => void } = $props();
  let dragging = $state<string | null>(null);
  let today = $derived(localDate(new Date($now)));
  let sections = $derived(getTodoSections($appState.tasks, today));
  let capacity = $derived($appState.settings.dailyCapacity);
  let allocated = $derived(
    sections[0].tasks.reduce((sum, t) => sum + t.estimate, 0),
  );
  let doneToday = $derived(
    $appState.records
      .filter((r) => localDate(new Date(r.at)) === today)
      .reduce((sum, r) => sum + r.pomodoros, 0),
  );
  async function drop(event: DragEvent, date: string) {
    event.preventDefault();
    dragging = null;
    const id = event.dataTransfer?.getData('text/plain');
    const task = $appState.tasks.find((t) => t.id === id);
    if (!task || task.date === date) return;
    if (await send('task:move', { id, date })) notify('예정일을 변경했습니다.');
  }
  function setCapacity(value: number) {
    if (value < 1 || value > 16) return;
    send('settings:save', { dailyCapacity: value });
  }
</script>

<div class="todo-sections">
  {#if $planOpen}<PlanCard />{/if}
  {#each sections as section, index (section.date)}
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
        <h2 class="wave">
          {section.label} <span class="badge">{section.tasks.length}</span>
        </h2>
        {#if index === 0}
          <div class="capacity-control">
            <span class="muted">오늘 가능</span>
            <button
              class="step"
              aria-label="오늘 가능 포모도로 줄이기"
              disabled={capacity <= 1}
              onclick={() => setCapacity(capacity - 1)}>−</button
            >
            <span class="num capacity-value">{capacity}</span>
            <button
              class="step"
              aria-label="오늘 가능 포모도로 늘리기"
              disabled={capacity >= 16}
              onclick={() => setCapacity(capacity + 1)}>+</button
            >
          </div>
        {/if}
      </div>
      {#if index === 0}
        <CapacityRow {capacity} {allocated} done={doneToday} />
      {/if}
      {#if section.tasks.length}
        <TaskList
          tasks={section.tasks}
          {onedit}
          ordered={index === 0}
          backlog={!section.date}
          showDate={false}
        />
      {/if}
      <QuickAdd date={section.date} label={section.label} />
    </section>
  {/each}
</div>
