<script lang="ts">
  import { errorText } from '../lib/account';
  // One flow for new and returning users. Supabase emails a sign-in link;
  // opening it on this computer signs the app in, and the parent sees the
  // new user through the account status subscription.
  let { id = 'account' }: { id?: string } = $props();
  let email = $state(''),
    sent = $state(false),
    busy = $state(false),
    error = $state('');
  async function request(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await window.to3mato!.account.requestLink(email.trim());
      sent = true;
    } catch (failure) {
      error = errorText(failure);
    } finally {
      busy = false;
    }
  }
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
        disabled={busy || !email.trim()}>로그인 링크 받기</button
      >
    </div>
    {#if sent}<p class="auth-sent" role="status">
        로그인 링크를 보냈습니다. 이 컴퓨터에서 메일의 링크를 여세요.
      </p>{/if}
  </form>
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
</div>
