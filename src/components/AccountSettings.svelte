<script lang="ts">
  import { onMount } from 'svelte';
  import type { AccountStatus } from '../lib/types';
  import { backupMedia, adoptMedia, mediaSyncError } from '../lib/media-sync';
  import { syncContext } from '../lib/sync-context';
  let account = $state<AccountStatus | null>(null);
  let email = $state(''),
    code = $state(''),
    sent = $state(false),
    busy = $state(false),
    error = $state('');
  onMount(() =>
    window.to3mato?.account.subscribe((value) => (account = value)),
  );
  async function run(action: () => Promise<unknown>) {
    busy = true;
    error = '';
    try {
      await action();
      account = await window.to3mato!.account.status();
    } catch (failure) {
      error =
        failure instanceof Error
          ? failure.message.replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              '',
            )
          : '요청을 처리하지 못했습니다.';
    } finally {
      busy = false;
    }
  }
  async function enable() {
    const adopt = account?.adoptLocalMedia;
    const backup = await backupMedia(adopt ? 'local' : account?.scope);
    account = await window.to3mato!.account.enable();
    const next = await window.to3mato!.load();
    syncContext.set(next.syncContext);
    // Adoption is explicitly allowed only for the first account bound to local data.
    if (adopt && account.adoptLocalMedia) {
      await adoptMedia(backup);
      await window.to3mato!.account.mediaAdopted();
    }
    location.reload();
  }
  function exportConflict(conflict: AccountStatus['conflicts'][number]) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(conflict, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `to3mato-conflict-${conflict.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

{#if account}
  <section class="settings-card" aria-labelledby="account-title">
    <h2 id="account-title">계정</h2>
    {#if !account.configured}
      <p>이 실행 환경에서는 계정 기능을 사용할 수 없습니다.</p>
    {:else}
      <p>연동하면 다른 기기와 동기화되어 사용하실 수 있습니다.</p>
      {#if !account.user}
        <div class="setting-row">
          <label for="account-email">이메일</label><input
            id="account-email"
            type="email"
            bind:value={email}
            disabled={busy}
          />
        </div>
        <button
          class="secondary"
          disabled={busy || !email}
          onclick={() =>
            run(async () => {
              await window.to3mato!.account.requestCode(email);
              sent = true;
            })}>인증 코드 받기</button
        >
        {#if sent}
          <p>인증 코드를 보냈습니다. 10분 안에 입력하세요.</p>
          <div class="setting-row">
            <label for="account-code">인증 코드</label><input
              id="account-code"
              inputmode="numeric"
              autocomplete="one-time-code"
              bind:value={code}
              disabled={busy}
            />
          </div>
          <button
            class="secondary"
            disabled={busy || !code}
            onclick={() =>
              run(() => window.to3mato!.account.verify(email, code))}
            >로그인</button
          >
        {/if}
      {:else}
        <p>{account.user.email}</p>
        <div class="data-actions">
          {#if account.enabled}
            <button
              class="secondary"
              disabled={busy}
              onclick={() => run(() => window.to3mato!.account.disable())}
              >연동 해제</button
            >
            <button
              class="secondary"
              disabled={busy}
              onclick={() => run(() => window.to3mato!.account.syncNow())}
              >지금 동기화</button
            >
          {:else}
            <button
              class="secondary"
              disabled={busy}
              onclick={() => run(enable)}>연동</button
            >
          {/if}
          <button
            class="secondary"
            disabled={busy}
            onclick={() =>
              run(async () => {
                await window.to3mato!.account.logout();
                location.reload();
              })}>로그아웃</button
          >
          <button
            class="secondary"
            disabled={busy}
            onclick={() =>
              run(async () => {
                const result = await window.to3mato!.account.remove();
                if (!result.user) location.reload();
              })}>계정 삭제</button
          >
        </div>
        {#if account.pending}<p>전송 대기 {account.pending}</p>{/if}
        {#if account.mediaPending}<p>
            파일 전송 대기 {account.mediaPending}
          </p>{/if}
        {#each account.conflicts.filter((item) => !item.archived) as conflict (conflict.id)}
          <div class="setting-row">
            <span
              >{conflict.reason === 'initial-timer'
                ? '연동 전 타이머'
                : '동기화 충돌'}</span
            ><button class="secondary" onclick={() => exportConflict(conflict)}
              >내보내기</button
            >{#if conflict.reason === 'initial-timer'}<button
                class="secondary"
                onclick={() =>
                  run(() =>
                    window.to3mato!.account.resolve(conflict.id, 'timer'),
                  )}>타이머 적용</button
              >{/if}<button
              class="secondary"
              onclick={() =>
                run(() => window.to3mato!.account.resolve(conflict.id, 'keep'))}
              >별도 보관</button
            >
          </div>
        {/each}
        {#if account.conflicts.some((item) => item.archived)}
          <details>
            <summary>보관된 기록</summary
            >{#each account.conflicts.filter((item) => item.archived) as conflict (conflict.id)}<button
                class="secondary"
                onclick={() => exportConflict(conflict)}>내보내기</button
              >{/each}
          </details>
        {/if}
      {/if}
    {/if}
    {#if error || account.error || account.mediaError || $mediaSyncError}<p
        role="alert"
      >
        {error || account.error || account.mediaError || $mediaSyncError}
      </p>{/if}
  </section>
{/if}
