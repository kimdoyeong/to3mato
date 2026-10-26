<script lang="ts">
  import { onMount } from 'svelte';
  import type { UpdateStatus } from '../lib/types';
  import {
    state as appState,
    send,
    notify,
    isDesktop,
    exportData,
    importNative,
    importBrowser,
  } from '../lib/client';
  import WeekdayPicker from './WeekdayPicker.svelte';
  let { onreview }: { onreview: () => void } = $props();
  import Tomato from './Tomato.svelte';
  let input: HTMLInputElement;
  let version = $state('');
  let update = $state<UpdateStatus>({ status: 'idle' });
  let restarting = $state(false);
  const updateError =
    '업데이트를 확인하지 못했습니다. 네트워크 연결을 확인하세요.';
  onMount(() => {
    if (!window.to3mato) return;
    let active = true;
    window.to3mato
      .version()
      .then((value) => {
        if (active) version = value;
      })
      .catch(() => {
        if (active) update = { status: 'error', message: updateError };
      });
    const unsubscribe = window.to3mato.update.subscribe((value) => {
      update = value;
      if (value.status === 'error') restarting = false;
    });
    return () => {
      active = false;
      unsubscribe();
    };
  });
  async function checkUpdate() {
    update = { status: 'checking' };
    try {
      update = await window.to3mato!.update.check();
    } catch {
      update = { status: 'error', message: updateError };
    }
  }
  async function installUpdate() {
    restarting = true;
    try {
      if (!(await window.to3mato!.update.install())) restarting = false;
    } catch {
      restarting = false;
      update = { status: 'error', message: updateError };
    }
  }
  async function change(field: string, value: string) {
    if (await send('settings:save', { [field]: Number(value) }))
      notify('다음 포모도로부터 적용됩니다.');
  }
</script>

<section class="settings-card" aria-labelledby="reminder-title">
  <h2 id="reminder-title">알림</h2>
  <div class="setting-row">
    <label for="plan-time">계획 시각</label><input
      id="plan-time"
      type="time"
      value={$appState.settings.planAt}
      onchange={(event) =>
        send('settings:save', { planAt: event.currentTarget.value })}
    />
  </div>
  <div class="setting-row">
    <label for="review-time">돌아보기 시각</label><input
      id="review-time"
      type="time"
      value={$appState.settings.reviewAt}
      onchange={(event) =>
        send('settings:save', { reviewAt: event.currentTarget.value })}
    />
  </div>
  <WeekdayPicker
    value={$appState.settings.remindDays}
    onchange={(remindDays) => send('settings:save', { remindDays })}
  />
  <button class="btn-line" data-open-review onclick={onreview}>돌아보기</button>
</section>

<section class="settings-card">
  <h2>포모도로 설정</h2>
  <p>변경한 시간은 다음 포모도로부터 적용됩니다.</p>
  <div class="setting-row">
    <label for="focus-setting">집중 시간</label><select
      id="focus-setting"
      value={$appState.settings.focus}
      onchange={(event) => change('focus', event.currentTarget.value)}
      >{#each [[900, '15분'], [1500, '25분'], [3000, '50분']] as [value, label]}<option
          {value}>{label}</option
        >{/each}</select
    >
  </div>
  <div class="setting-row">
    <label for="rest-setting">휴식 시간</label><select
      id="rest-setting"
      value={$appState.settings.rest}
      onchange={(event) => change('rest', event.currentTarget.value)}
      >{#each [[300, '5분'], [600, '10분']] as [value, label]}<option {value}
          >{label}</option
        >{/each}</select
    >
  </div>
  {#if isDesktop}
    <div class="setting-row">
      <label for="tray-display-setting">트레이 표시</label>
      <select
        id="tray-display-setting"
        value={$appState.settings.trayDisplay}
        onchange={(event) =>
          send('settings:save', { trayDisplay: event.currentTarget.value })}
      >
        <option value="clock">시간</option>
        <option value="bar">막대</option>
        <option value="ring">원형</option>
        <option value="hourglass">모래시계</option>
      </select>
    </div>
  {/if}
</section>

<section class="settings-card">
  <h2>최근 집중 기록</h2>
  <p>작업 전환 시 0 / 0.5 / 1포모도로로 반올림합니다.</p>
  {#each $appState.records.slice(-10).reverse() as record}<div
      class="record-row"
    >
      <div class="record-title">
        {$appState.tasks.find((t) => t.id === record.taskId)?.title ||
          '삭제된 할 일'}<br /><small
          >실제 {Math.floor(record.seconds / 60)}분 {Math.floor(
            record.seconds % 60,
          )}초</small
        >
      </div>
      <span class="record-value pomo-count"
        >{record.pomodoros}<Tomato filled /></span
      >
    </div>{:else}<p>집중 기록이 없습니다.</p>{/each}
</section>
<section class="settings-card">
  <h2>로컬 데이터</h2>
  <p>
    {isDesktop
      ? '할 일과 집중 기록은 이 컴퓨터의 앱 데이터 폴더에 저장됩니다.'
      : '할 일과 집중 기록은 이 브라우저에 저장됩니다.'}
  </p>
  <div class="data-actions">
    <button class="secondary" onclick={exportData}>데이터 내보내기</button
    ><button
      class="secondary"
      onclick={() => (isDesktop ? importNative() : input.click())}
      >데이터 가져오기</button
    >
  </div>
  <input
    class="file-input"
    bind:this={input}
    type="file"
    accept=".json,application/json"
    aria-label="가져올 데이터 파일"
    onchange={(event) => {
      const file = event.currentTarget.files?.[0];
      if (file) importBrowser(file);
      event.currentTarget.value = '';
    }}
  />
</section>
{#if isDesktop}
  <section class="settings-card" aria-labelledby="update-title">
    <h2 id="update-title">업데이트</h2>
    <p>
      새 버전이 있으면 자동으로 내려받습니다. 설치는 앱을 다시 시작할 때
      진행됩니다.
    </p>
    {#if version}<p>현재 버전 {version}</p>{/if}
    <p role="status">
      {#if update.status === 'checking'}확인 중입니다.
      {:else if update.status === 'downloading'}{update.version} 내려받는 중 {update.percent}%
      {:else if update.status === 'ready'}{update.version} 설치 준비가 끝났습니다.
        다시 시작하면 적용됩니다.
      {:else if update.status === 'error'}{updateError}
      {:else}최신 버전입니다.{/if}
    </p>
    <div class="data-actions">
      <button
        class="secondary"
        onclick={checkUpdate}
        disabled={restarting ||
          ['checking', 'downloading', 'ready'].includes(update.status)}
        >업데이트 확인</button
      >
      {#if update.status === 'ready'}
        <button class="secondary" onclick={installUpdate} disabled={restarting}
          >다시 시작</button
        >
      {/if}
    </div>
  </section>
{/if}
