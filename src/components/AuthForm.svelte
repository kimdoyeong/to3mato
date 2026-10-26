<script lang="ts">
  import { tick } from 'svelte';
  import type { AccountStatus, AuthMode } from '../lib/types';
  import { errorText } from '../lib/account';
  let {
    id = 'account',
    onverified = () => {},
  }: {
    id?: string;
    onverified?: (status: AccountStatus) => void;
  } = $props();
  let mode = $state<AuthMode>('login'),
    email = $state(''),
    code = $state(''),
    sent = $state(false),
    busy = $state(false),
    error = $state('');
  let codeInput = $state<HTMLInputElement>();
  function select(next: AuthMode) {
    if (busy || mode === next) return;
    mode = next;
    sent = false;
    code = '';
    error = '';
  }
  async function run(action: () => Promise<void>) {
    busy = true;
    error = '';
    try {
      await action();
    } catch (failure) {
      error = errorText(failure);
    } finally {
      busy = false;
    }
  }
  async function request(event: SubmitEvent) {
    event.preventDefault();
    await run(async () => {
      await window.to3mato!.account.requestCode(email.trim(), mode);
      sent = true;
      code = '';
    });
    // The code field renders, and is enabled, only after the request settles.
    if (sent) {
      await tick();
      codeInput?.focus();
    }
  }
  const verify = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () =>
      onverified(
        await window.to3mato!.account.verify(email.trim(), code.trim()),
      ),
    );
  };
</script>

<div class="auth-form">
  <div class="add-mode" role="tablist">
    {#each [['login', '로그인'], ['signup', '회원가입']] as [value, label]}<button
        type="button"
        role="tab"
        id="{id}-tab-{value}"
        aria-controls="{id}-panel"
        aria-selected={mode === value}
        class:selected={mode === value}
        disabled={busy}
        onclick={() => select(value as AuthMode)}>{label}</button
      >{/each}
  </div>
  <div id="{id}-panel" role="tabpanel" aria-labelledby="{id}-tab-{mode}">
    <form class="auth-step" onsubmit={request}>
      <label for="{id}-email">이메일</label>
      <div class="auth-field">
        <input
          id="{id}-email"
          type="email"
          autocomplete="email"
          maxlength="254"
          bind:value={email}
          oninput={() => {
            sent = false;
            error = '';
          }}
          disabled={busy}
        /><button
          type="submit"
          class="btn-line"
          disabled={busy || !email.trim()}>인증 코드 받기</button
        >
      </div>
    </form>
    {#if sent}
      <form class="auth-step" onsubmit={verify}>
        <p>인증 코드를 보냈습니다. 10분 안에 입력하세요.</p>
        <label for="{id}-code">인증 코드</label>
        <div class="auth-field">
          <input
            id="{id}-code"
            bind:this={codeInput}
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="10"
            bind:value={code}
            disabled={busy}
          /><button
            type="submit"
            class="primary"
            disabled={busy || !code.trim()}
            >{mode === 'login' ? '로그인' : '회원가입'}</button
          >
        </div>
      </form>
    {/if}
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  </div>
</div>
