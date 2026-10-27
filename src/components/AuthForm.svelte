<script lang="ts">
  import { tick } from 'svelte';
  import type { AccountStatus } from '../lib/types';
  import { errorText } from '../lib/account';
  // One flow for new and returning users: an address used for the first
  // time gets its account when the code is verified.
  let {
    id = 'account',
    onverified = () => {},
  }: {
    id?: string;
    onverified?: (status: AccountStatus) => void;
  } = $props();
  let email = $state(''),
    code = $state(''),
    sent = $state(false),
    busy = $state(false),
    error = $state('');
  let codeInput = $state<HTMLInputElement>();
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
      await window.to3mato!.account.requestCode(email.trim());
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
          disabled={busy || !code.trim()}>로그인</button
        >
      </div>
    </form>
  {/if}
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
</div>
