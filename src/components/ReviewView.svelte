<script lang="ts">
  import { onMount } from 'svelte';
  import { state as appState, now } from '../lib/client';
  import { localDate, offsetDate, usedPomodoros } from '../lib/domain.mjs';
  import { finishRitual } from '../lib/ritual-state';
  import CapacityRow from './parts/CapacityRow.svelte';
  import Circ from './parts/Circ.svelte';
  import Tomato from './Tomato.svelte';
  import Mascot from './Mascot.svelte';
  import Icon from './Icon.svelte';
  import CapacityStepper from './CapacityStepper.svelte';
  import RitualTask from './RitualTask.svelte';
  let { onclose }: { onclose: () => void } = $props();
  let heading: HTMLHeadingElement;
  onMount(() => heading.focus());
  let today = $derived(localDate(new Date($now)));
  let tomorrow = $derived(offsetDate(1, today));
  let tasks = $derived($appState.tasks.filter((t) => t.date === today));
  let pending = $derived(tasks.filter((t) => !t.done));
  let next = $derived($appState.tasks.filter((t) => t.date === tomorrow));
  let done = $derived(
    $appState.records
      .filter((r) => localDate(new Date(r.at)) === today)
      .reduce((sum, r) => sum + r.pomodoros, 0),
  );
  let capacity = $derived($appState.settings.dailyCapacity);
  let allocated = $derived(tasks.reduce((sum, t) => sum + t.estimate, 0));
  function save() {
    finishRitual('review', today);
    onclose();
  }
</script>

<div class="review-view">
  <header class="ritual-heading">
    <h1 class="wave review-heading" tabindex="-1" bind:this={heading}>
      돌아보기
    </h1>
    <time class="sticker-date" datetime={today}
      >{new Date($now).toLocaleDateString('ko-KR', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      })}</time
    ><button class="btn-text" aria-label="닫기" onclick={onclose}
      ><Icon name="close" /></button
    >
  </header>
  <section class="paper peach tilt-c review-summary" aria-label="완료">
    <span class="tape l pink" aria-hidden="true"></span>
    <div class="review-mascot"><Mascot phase="idle" /></div>
    <div class="stat"><small>완료</small><b class="num">{done}</b></div>
    <div class="stat">
      <small>오늘 가능</small><b class="num">{capacity}</b>
    </div>
    <div class="stat"><small>배치</small><b class="num">{allocated}</b></div>
    <div class="review-stamps" aria-hidden="true">
      {#each Array(Math.max(capacity, Math.ceil(done))) as _, i}<Tomato
          size="lg"
          variant={i + 1 <= done ? 'filled' : i < done ? 'half' : 'empty'}
        />{/each}
    </div>
  </section>
  <section aria-labelledby="review-tasks-title">
    <h2 class="wave" id="review-tasks-title">
      오늘 할 일 <span class="badge">{tasks.length}</span>
    </h2>
    <table class="review-table">
      <thead
        ><tr
          ><th aria-label="할 일 이름"></th><th>처음 예상</th><th>실제 사용</th
          ><th></th></tr
        ></thead
      ><tbody>
        {#each tasks as task, index (task.id)}
          {@const used = usedPomodoros($appState, task.id)}
          {@const diff = used - task.estimate}
          <tr
            ><td
              ><div class="review-task-name">
                <Circ
                  n={task.done ? 'check' : index + 1}
                  state={task.done ? 'ok' : ''}
                /><span class:done={task.done}>{task.title}</span>
              </div></td
            ><td><span class="pomo-count">{task.estimate}<Tomato /></span></td
            ><td><span class="pomo-count">{used}<Tomato filled /></span></td><td
              class="num"
              class:over={diff > 0}
              class:saved={diff < 0}>{diff > 0 ? '+' : ''}{diff}</td
            ></tr
          >
        {/each}
      </tbody>
    </table>
  </section>
  <section class="ritual-section" aria-labelledby="review-pending-title">
    <h2 id="review-pending-title" class="wave">
      미완료 <span class="badge">{pending.length}</span>
    </h2>
    {#each pending as task (task.id)}<RitualTask
        {task}
        targetDate={tomorrow}
        mode="review"
      />{:else}<p class="muted">미완료 할 일이 없습니다.</p>{/each}
  </section>
  <section class="ritual-section" aria-labelledby="review-tomorrow-title">
    <div class="ritual-heading">
      <h2 class="wave" id="review-tomorrow-title">
        내일 <span class="badge">{next.length}</span>
      </h2>
      <CapacityStepper label="내일 가능" />
    </div>
    <CapacityRow
      {capacity}
      allocated={next.reduce((sum, t) => sum + t.estimate, 0)}
      done={0}
    />
    {#each next as task, index (task.id)}<div class="paper flat ritual-task">
        <Circ n={index + 1} /><span class="ritual-task-title">{task.title}</span
        ><span class="pomo-count">{task.estimate}<Tomato /></span>
      </div>{/each}
  </section>
  <div class="dialog-footer">
    <button class="primary" onclick={save}>저장</button>
  </div>
</div>
