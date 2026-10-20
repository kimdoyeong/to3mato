<script lang="ts">
  import { state as appState, now, send, notify } from '../lib/client';
  import { localDate, elapsedSeconds } from '../lib/domain.mjs';
  import Mascot from './Mascot.svelte';
  import Icon from './Icon.svelte';
  import Tomato from './Tomato.svelte';
  import Pomodoros from './Pomodoros.svelte';
  let timer = $derived($appState.timer),
    rest = $derived(timer?.phase === 'rest'),
    today = $derived(localDate(new Date($now)));
  let tasks = $derived($appState.tasks.filter((t) => t.date === today)),
    pending = $derived(tasks.filter((t) => !t.done));
  let task = $derived($appState.tasks.find((t) => t.id === timer?.taskId));
  let elapsed = $derived(timer ? elapsedSeconds(timer, $now) : 0);
  let seconds = $derived(
    Math.max(
      0,
      Math.ceil((timer?.duration || $appState.settings.focus) - elapsed),
    ),
  );
  let clock = $derived(
    String(Math.floor(seconds / 60)).padStart(2, '0') +
      ':' +
      String(seconds % 60).padStart(2, '0'),
  );
  let daily = $derived(
    $appState.records
      .filter((r) => localDate(new Date(r.at)) === today)
      .reduce((sum, r) => sum + r.pomodoros, 0),
  );
  async function play(id: string) {
    if (timer?.phase === 'focus' && timer.taskId === id && timer.running) {
      await send('timer:toggle');
      return;
    }
    const before = $appState.records.length;
    if (await send('timer:play', { id })) {
      if ($appState.records.length > before)
        notify(
          `${$appState.records.at(-1)?.pomodoros}포모도로 기록 · 새 타이머 시작`,
        );
    }
  }
  async function end() {
    const wasRest = rest;
    if (await send('timer:end'))
      notify(wasRest ? '휴식 종료' : '집중 기록 저장 완료');
  }
</script>

<svelte:head
  ><title
    >{timer?.running
      ? `${clock} · ${rest ? '휴식' : '집중'} — To3mato`
      : 'To3mato'}</title
  ></svelte:head
>
<aside class="execution" aria-label="실행 영역">
  {#if timer}<div class="execution-heading">
      <span class="live-tag" class:running={timer.running && !rest}
        >{rest
          ? timer.running
            ? '휴식 중'
            : '휴식 대기'
          : timer.running
            ? '집중 중'
            : '일시정지'}</span
      >
    </div>{/if}
  <section class="timer-panel">
    <Mascot
      phase={timer ? (rest ? 'rest' : 'focus') : 'idle'}
      paused={!!timer && !timer.running}
    />{#if rest || task}<h2 id="focus-title">
        {rest ? '휴식' : task?.title}
      </h2>{/if}
    <div
      class="clock"
      id="clock"
      role="timer"
      aria-label={`남은 시간 ${clock}`}
    >
      {#each [...clock] as digit, i (i)}<span
          class={digit === ':' ? 'colon' : 'digit'}>{digit}</span
        >{/each}
    </div>
    <div class="timer-track">
      <div
        style:width={timer ? `${(elapsed / timer.duration) * 100}%` : '0%'}
      ></div>
    </div>
    <div class="timer-actions">
      <button
        class="primary"
        disabled={!timer && !pending.length}
        onclick={() => (timer ? send('timer:toggle') : play(pending[0].id))}
        ><Icon name={timer?.running ? 'pause' : 'play'} />{timer
          ? timer.running
            ? '일시정지'
            : rest
              ? '휴식 시작'
              : '집중 재개'
          : '집중 시작'}</button
      ><button
        class="icon-button end-button"
        disabled={!timer}
        onclick={end}
        aria-label={rest ? '휴식 종료' : '집중 종료'}
        title={rest ? '휴식 종료' : '집중 종료'}
        ><Icon name={rest ? 'arrow' : 'stop'} /></button
      >
    </div>
  </section>
  <section class="today-section">
    <div class="section-heading">
      <h2>오늘 할 일 <span class="count">{pending.length}</span></h2>
      <span
        >예상 <span class="pomo-count"
          >{tasks.reduce((sum, t) => sum + t.estimate, 0)}<Tomato
            filled
          /></span
        ></span
      >
    </div>
    {#each tasks as item, i (item.id)}{@const active =
        timer?.phase === 'focus' && timer.taskId === item.id}
      <div class="today-row" class:active class:done={item.done}>
        <span class="today-number"
          >{#if item.done}<Icon name="check" />{:else}{String(i + 1).padStart(
              2,
              '0',
            )}{/if}</span
        >
        <div class="today-info">
          <div class="today-name" class:task-title={item.done}>
            {item.title}
          </div>
          <Pomodoros
            estimate={item.estimate}
            actual={$appState.records
              .filter((r) => r.taskId === item.id)
              .reduce((sum, r) => sum + r.pomodoros, 0)}
          />
        </div>
        <button
          class="play-button"
          disabled={item.done}
          onclick={() => play(item.id)}
          aria-label={`${item.title} ${active && timer?.running ? '일시정지' : '시작'}`}
          ><Icon name={active && timer?.running ? 'pause' : 'play'} /></button
        >
      </div>{:else}<div class="empty">오늘 예정된 할 일이 없습니다.</div>{/each}
  </section>
  <div class="daily-summary">
    <div><strong>{daily} <small>포모도로</small></strong></div>
    <div class="daily-dots">
      {#each Array(Math.max(3, Math.min(8, Math.ceil(daily)))) as _, i}<Tomato
          filled={i < daily}
        />{/each}
    </div>
  </div>
</aside>
