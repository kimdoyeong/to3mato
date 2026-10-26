<script lang="ts">
  import { state as appState, now, send, notify } from '../lib/client';
  import { localDate, elapsedSeconds, usedPomodoros } from '../lib/domain.mjs';
  import Mascot from './Mascot.svelte';
  import Icon from './Icon.svelte';
  import Tomato from './Tomato.svelte';
  import Pomodoros from './Pomodoros.svelte';
  import CheckinCard from './CheckinCard.svelte';
  import Ticket from './Ticket.svelte';
  import Circ from './parts/Circ.svelte';
  import HandBar from './parts/HandBar.svelte';
  let timer = $derived($appState.timer),
    rest = $derived(timer?.phase === 'rest'),
    checkin = $derived(timer?.phase === 'checkin'),
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
  let capacity = $derived($appState.settings.dailyCapacity);
  // A newly issued ticket shows for a moment before it goes to the diary.
  let popped = $state<string | null>(null);
  let knownTickets = $appState.tickets.length;
  let popTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const count = $appState.tickets.length;
    if (count > knownTickets) {
      popped = $appState.tickets.at(-1)?.id ?? null;
      clearTimeout(popTimer);
      popTimer = setTimeout(() => (popped = null), 2600);
    }
    knownTickets = count;
  });
  let poppedTicket = $derived(
    popped ? $appState.tickets.find((t) => t.id === popped) : null,
  );
  let status = $derived(
    !timer
      ? ''
      : checkin
        ? '진척 확인'
        : rest
          ? timer.running
            ? '휴식 중'
            : '휴식 대기'
          : timer.running
            ? '집중 중'
            : '일시정지',
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
  {#if poppedTicket}
    <div class="ticket-pop" role="status" aria-live="polite">
      <Ticket ticket={poppedTicket} />
    </div>
  {/if}
  {#if status}<div class="execution-heading">
      <span class="live-tag tag" class:running={timer?.running && !rest}
        >{status}</span
      >
    </div>{/if}
  {#if checkin && task}
    <CheckinCard {task} used={usedPomodoros($appState, task.id)} />
  {:else}
    <section class="timer-panel paper peach">
      <span class="tape" aria-hidden="true"></span>
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
        <HandBar value={timer ? elapsed / timer.duration : 0} />
      </div>
      {#if task && !rest}
        <div class="timer-progress muted">
          예상 <Pomodoros
            estimate={task.estimate}
            actual={usedPomodoros($appState, task.id)}
          />
        </div>
      {/if}
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
  {/if}
  <section class="today-section">
    <div class="section-heading">
      <h2 class="wave">
        오늘 할 일 <span class="count badge">{pending.length}</span>
      </h2>
      <span
        >예상 <span class="pomo-count"
          >{tasks.reduce((sum, t) => sum + t.estimate, 0)}<Tomato
            filled
          /></span
        ></span
      >
    </div>
    {#each tasks as item, i (item.id)}{@const active =
        timer?.phase !== 'rest' && timer?.taskId === item.id}
      <div class="today-row exec-row" class:active class:done={item.done}>
        <Circ
          n={item.done ? 'check' : i + 1}
          state={item.done ? 'ok' : active ? 'on' : ''}
        />
        <div class="today-info">
          <div class="today-name" class:task-title={item.done}>
            {item.title}
          </div>
          <Pomodoros
            estimate={item.estimate}
            actual={usedPomodoros($appState, item.id)}
          />
        </div>
        <button
          class="play-button play"
          class:active={active && timer?.running}
          disabled={item.done}
          onclick={() => play(item.id)}
          aria-label={`${item.title} ${active && timer?.running ? '일시정지' : '시작'}`}
          ><Icon name={active && timer?.running ? 'pause' : 'play'} /></button
        >
      </div>{:else}<div class="empty">오늘 예정된 할 일이 없습니다.</div>{/each}
  </section>
  <div class="daily-summary paper butter" aria-label="오늘 완료 포모도로">
    <span class="tape r green" aria-hidden="true"></span>
    <div><strong>{daily} <small>포모도로</small></strong></div>
    <div class="daily-dots">
      {#each Array(Math.max(capacity, Math.ceil(daily))) as _, i (i)}<Tomato
          filled={i < daily}
        />{/each}
    </div>
  </div>
</aside>
