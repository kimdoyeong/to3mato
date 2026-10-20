<script lang="ts">
  import { state as appState, now, send, notify } from '../lib/client';
  import { localDate, offsetDate, dateLabel } from '../lib/domain.mjs';
  import TaskList from './TaskList.svelte';
  import Icon from './Icon.svelte';
  import Tomato from './Tomato.svelte';
  import type { Task } from '../lib/types';
  let {
    onedit,
    onadd,
    selected = $bindable(localDate()),
    week = $bindable(0),
  }: {
    onedit: (task: Task) => void;
    onadd: (date: string) => void;
    selected?: string;
    week?: number;
  } = $props();
  let dragging = $state<string | null>(null);
  let today = $derived(localDate(new Date($now)));
  let monday = $derived(
    offsetDate(
      -((new Date(today + 'T12:00:00').getDay() + 6) % 7) + week * 7,
      today,
    ),
  );
  let dates = $derived(
    Array.from({ length: 7 }, (_, i) => offsetDate(i, monday)),
  );
  async function drop(event: DragEvent, date: string) {
    event.preventDefault();
    dragging = null;
    const id = event.dataTransfer?.getData('text/plain');
    if (id && (await send('task:move', { id, date })))
      notify('예정일을 변경했습니다.');
  }
</script>

<div class="calendar-top">
  <strong
    >{new Date(monday + 'T12:00:00').toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
    })}</strong
  >
  <div class="calendar-controls">
    <button
      class="text-button"
      onclick={() => {
        week = 0;
        selected = today;
      }}>이번 주</button
    ><button class="icon-button" onclick={() => week--} aria-label="이전 주"
      ><Icon name="back" /></button
    ><button class="icon-button" onclick={() => week++} aria-label="다음 주"
      ><Icon name="arrow" /></button
    >
  </div>
</div>
<div class="week-grid">
  {#each dates as date, i (date)}<button
      class="day-cell"
      class:selected={date === selected}
      class:today={date === today}
      class:drag-over={date === dragging}
      onclick={() => (selected = date)}
      ondragover={(event) => {
        event.preventDefault();
        dragging = date;
      }}
      ondragleave={() => (dragging = null)}
      ondrop={(event) => drop(event, date)}
      aria-label={dateLabel(date)}
      ><span class="day-label"
        >{['월', '화', '수', '목', '금', '토', '일'][i]}</span
      ><span class="day-num">{Number(date.slice(-2))}</span><span
        class="day-pomo pomo-count"
        >{$appState.tasks
          .filter((t) => t.date === date)
          .reduce((sum, t) => sum + t.estimate, 0)}<Tomato filled /></span
      ></button
    >{/each}
</div>
<div class="section-heading">
  <h2>{dateLabel(selected)}</h2>
  <span>날짜로 드래그하여 이동</span>
</div>
<TaskList
  tasks={$appState.tasks.filter((t) => t.date === selected)}
  {onedit}
/><button class="add-task" onclick={() => onadd(selected)}
  ><Icon name="plus" />할 일 추가</button
>
