<script lang="ts">
  import Tomato from './Tomato.svelte';
  import Icon from './Icon.svelte';
  import { send, notify } from '../lib/client';
  import { MAX_TASK_ESTIMATE } from '../lib/domain.mjs';
  import type { Task } from '../lib/types';
  let { task, used }: { task: Task; used: number } = $props();
  // The finished pomodoro counts, so the suggestion is one less than before.
  let remaining = $state(0);
  let busy = $state(false);
  let max = $derived(Math.max(MAX_TASK_ESTIMATE, task.estimate));
  $effect.pre(() => {
    remaining = Math.min(max, Math.max(0, task.remaining - 1));
  });
  let total = $derived(Math.max(task.estimate, Math.ceil(used) + remaining));
  async function run(type: string, payload?: Record<string, unknown>) {
    if (busy) return;
    busy = true;
    const success = await send(type, payload);
    busy = false;
    if (!success) return;
    if (type === 'checkin:done') notify('할 일을 완료했습니다.');
    if (type === 'checkin:followup') notify('할 일을 추가했습니다.');
  }
</script>

<section
  class="timer-panel checkin paper peach"
  aria-labelledby="checkin-title"
>
  <span class="tape" aria-hidden="true"></span>
  <h2 id="checkin-title">진척 확인</h2>
  <div class="receipt">
    <p class="receipt-task" id="focus-title">{task.title}</p>
    <dl class="receipt-lines">
      <div class="rline">
        <dt>처음 예상</dt>
        <dd>
          <span class="num">{task.estimate}</span>
          <span class="tomatoes"
            >{#each Array(Math.min(6, task.estimate)) as _, i (i)}<Tomato
              />{/each}</span
          >
        </dd>
      </div>
      <div class="rline">
        <dt>실제 사용</dt>
        <dd>
          <span class="num">{used}</span>
          <span class="tomatoes"
            >{#each Array(Math.min(6, Math.ceil(used))) as _, i (i)}<Tomato
                filled
              />{/each}</span
          >
        </dd>
      </div>
      <div class="rline rline-edit">
        <dt><Icon name="pencil" />남은 예상</dt>
        <dd>
          <button
            class="step"
            aria-label="남은 예상 줄이기"
            disabled={busy || remaining <= 0}
            onclick={() => (remaining -= 1)}>−</button
          >
          <span class="num">{remaining}</span>
          <button
            class="step"
            aria-label="남은 예상 늘리기"
            disabled={busy || remaining >= max}
            onclick={() => (remaining += 1)}>+</button
          >
        </dd>
      </div>
    </dl>
    <div class="receipt-total muted">
      전체 <span class="tomatoes"
        >{#each Array(Math.min(8, total)) as _, i (i)}<Tomato
            filled={i < Math.floor(used)}
          />{/each}</span
      >
    </div>
  </div>
  <div class="checkin-actions">
    <button class="btn-text" disabled={busy} onclick={() => run('checkin:done')}
      >완료</button
    >
    <button
      class="btn-line"
      disabled={busy}
      onclick={() => run('checkin:followup')}>이어서 할 일 만들기</button
    >
    <button
      class="primary"
      disabled={busy}
      onclick={() => run('checkin:save', { remaining })}>저장</button
    >
  </div>
  <p class="muted checkin-hint">저장하면 휴식을 시작합니다.</p>
</section>
