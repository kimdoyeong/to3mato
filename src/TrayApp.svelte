<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppState, Command } from './lib/types';
  import { timerMenuState } from './lib/domain.mjs';
  let appState = $state<AppState | null>(null);
  let now = $state(Date.now());
  let error = $state('');
  let busy = $state(false);
  const view = $derived(appState ? timerMenuState(appState, now) : null);
  onMount(() => {
    const api = window.to3mato!;
    let active = true,
      received = false;
    const unsubscribe = api.subscribe((value) => {
      received = true;
      appState = value;
      now = Date.now();
    });
    const unsubscribeError = api.onError((message) => {
      error = message;
    });
    api
      .load()
      .then((value) => {
        if (active && !received) appState = value;
      })
      .catch((e) => {
        if (active) error = String(e.message);
      });
    let interval: ReturnType<typeof setInterval> | undefined;
    let windowVisible = false;
    const visibility = () => {
      clearInterval(interval);
      now = Date.now();
      if (windowVisible)
        interval = setInterval(() => {
          now = Date.now();
        }, 250);
    };
    const unsubscribeVisibility = api.subscribeVisibility((visible) => {
      windowVisible = visible;
      visibility();
    });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      clearInterval(interval);
      unsubscribe();
      unsubscribeError();
      unsubscribeVisibility();
      document.removeEventListener('visibilitychange', visibility);
    };
  });
  async function run(command: Command | null) {
    if (!command || busy) return;
    busy = true;
    error = '';
    try {
      await window.to3mato!.dispatch(command);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<main>
  {#if view}
    <div
      class="clock"
      id="tray-clock"
      role="timer"
      aria-label={`남은 시간 ${view.clock}`}
    >
      {#each [...view.clock] as digit, i (i)}<span
          class={digit === ':' ? 'colon' : 'digit'}>{digit}</span
        >{/each}
    </div>
    <div id="tray-status">{view.status}</div>
    <div id="tray-task" title={view.taskTitle}>{view.taskTitle}</div>
    <div class="actions">
      <button
        id="tray-primary"
        class="primary"
        disabled={busy || !view.primaryEnabled}
        onclick={() => run(view.command)}>{view.primary}</button
      >
      <button
        id="tray-end"
        disabled={busy || !view.endEnabled}
        onclick={() => run({ type: 'timer:end' })}>{view.end}</button
      >
    </div>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <button class="open" onclick={() => window.to3mato!.showMain()}
    >To3mato 열기</button
  >
</main>

<style>
  :global(html),
  :global(body),
  :global(#app) {
    min-width: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
  }
  main {
    height: 100%;
    overflow-y: auto;
    padding: 12px 16px;
    text-align: center;
    color: var(--ink);
  }
  .clock {
    font-size: 58px;
    line-height: 1.1;
    margin: 0 0 3px;
  }
  #tray-status {
    font-size: 17px;
  }
  #tray-task {
    height: 24px;
    line-height: 24px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--muted);
    margin: 4px 0 10px;
  }
  .actions {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }
  button {
    cursor: pointer;
    font-size: 16px;
    border: 1px solid var(--peach-deep);
    border-radius: 24px;
    padding: 8px 12px;
    background: var(--paper);
    color: var(--ink);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .primary {
    color: white;
    background: var(--red);
    font-size: 18px;
    min-width: 118px;
    padding: 8px 12px;
  }
  .open {
    display: block;
    margin: 14px auto 0;
    padding: 3px 6px;
    font-size: 14px;
    border: 0;
    background: transparent;
    text-decoration: underline;
    color: var(--muted);
  }
  p {
    font-size: 13px;
    max-height: 32px;
    overflow: auto;
    margin: 4px 0;
  }
</style>
