<script lang="ts">
  import { state as appState, now } from '../lib/client';
  import { localDate, offsetDate } from '../lib/domain.mjs';
  import { sevenDayAverage } from '../lib/rituals.mjs';
  import { finishRitual } from '../lib/ritual-state';
  import CapacityRow from './parts/CapacityRow.svelte';
  import Circ from './parts/Circ.svelte';
  import CapacityStepper from './CapacityStepper.svelte';
  import RitualTask from './RitualTask.svelte';
  import Icon from './Icon.svelte';
  let today = $derived(localDate(new Date($now)));
  let carry = $derived(
    $appState.tasks.filter((t) => t.date === offsetDate(-1, today) && !t.done),
  );
  let backlog = $derived($appState.tasks.filter((t) => !t.date && !t.done));
  let allocated = $derived(
    $appState.tasks
      .filter((t) => t.date === today)
      .reduce((sum, t) => sum + t.estimate, 0),
  );
  let done = $derived(
    $appState.records
      .filter((r) => localDate(new Date(r.at)) === today)
      .reduce((sum, r) => sum + r.pomodoros, 0),
  );
</script>

<section class="paper peach tilt-a plan-card" aria-labelledby="plan-title">
  <span class="tape" aria-hidden="true"></span>
  <div class="ritual-heading">
    <h2 id="plan-title" class="wave">계획 시작</h2>
    <button
      class="btn-text"
      aria-label="닫기"
      onclick={() => finishRitual('plan', today)}><Icon name="close" /></button
    >
  </div>
  <div class="ritual-section">
    <h3>
      <Circ n={1} state="on" />어제 미완료
      <span class="badge">{carry.length}</span>
    </h3>
    {#each carry as task (task.id)}<RitualTask
        {task}
        targetDate={today}
        mode="carry"
      />{:else}<p class="muted">어제 미완료 할 일이 없습니다.</p>{/each}
  </div>
  <div class="ritual-section">
    <div class="ritual-heading">
      <Circ n={2} state="on" /><CapacityStepper label="오늘 가능" /><span
        class="muted"
        >지난 7일 평균 {sevenDayAverage($appState.records, today)}</span
      >
    </div>
    <CapacityRow
      capacity={$appState.settings.dailyCapacity}
      {allocated}
      {done}
    />
  </div>
  <div class="ritual-section">
    <h3>
      <Circ n={3} state="on" />미지정
      <span class="badge">{backlog.length}</span>
    </h3>
    {#each backlog as task (task.id)}<RitualTask
        {task}
        targetDate={today}
        mode="backlog"
      />{/each}
  </div>
</section>
