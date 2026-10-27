<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AccountStatus } from '../lib/types';
  import { onboardingPending, finishOnboarding } from '../lib/onboarding';
  import { enableSync, errorText } from '../lib/account';
  import Mascot from './Mascot.svelte';
  import Tomato from './Tomato.svelte';
  import Circ from './parts/Circ.svelte';
  import AuthForm from './AuthForm.svelte';

  // Walkthrough copy comes from the published landing page.
  const intro = [
    {
      title: '일단 3번만 해봅시다. 토오오오마토.',
      body: [
        '당신은 오늘 몇 개의 포모도로를 완료할 수 있을까요?',
        '기록이 자산이 되는 포모도로 앱입니다.',
      ],
    },
    {
      title: '할 일을 정리',
      body: ['날짜와 프로젝트로 분류하고 예상 포모도로를 입력합니다.'],
    },
    {
      title: '하나를 실행',
      body: ['할 일의 재생 버튼을 누르면 해당 작업의 타이머가 시작됩니다.'],
    },
    {
      title: '기록을 확인',
      body: ['예상량과 실제 기록을 비교해 다음 할 일의 분량을 정합니다.'],
    },
  ];
  const last = intro.length;
  // Three recorded out of four estimated.
  const recorded: Array<'filled' | 'plan'> = ['filled', 'filled', 'filled', 'plan'];
  let dialog = $state<HTMLDialogElement>();
  let open = $state(false),
    step = $state(0),
    busy = $state(false),
    error = $state('');
  let account = $state<AccountStatus | null>(null);
  onMount(() => {
    let disposed = false;
    // Returns nothing: a returned Svelte state proxy cannot cross the
    // preload bridge and would throw inside the IPC listener.
    const stop = window.to3mato?.account.subscribe((value) => {
      account = value;
    });
    onboardingPending()
      .then(async (pending) => {
        if (!pending || disposed) return;
        open = true;
        await tick();
        dialog?.showModal();
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  });
  async function go(next: number) {
    error = '';
    step = next;
    await tick();
    dialog?.querySelector<HTMLElement>('[data-step-title]')?.focus();
  }
  async function finish() {
    if (busy) return;
    busy = true;
    try {
      await finishOnboarding();
      dialog?.close();
      open = false;
    } catch (failure) {
      error = errorText(failure);
    } finally {
      busy = false;
    }
  }
  async function enable() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      // Mark first, because enabling reloads into the account's data.
      await finishOnboarding();
      await enableSync(account);
    } catch (failure) {
      error = errorText(failure);
      busy = false;
    }
  }
</script>

{#if open}
  <dialog
    bind:this={dialog}
    class="onboarding"
    aria-labelledby="onboarding-title"
    oncancel={(event) => {
      event.preventDefault();
      void finish();
    }}
  >
    <div class="onboarding-dots" aria-hidden="true">
      {#each Array(last + 1) as _, i (i)}<span class:on={i === step}
        ></span>{/each}
    </div>
    <div class="onboarding-content" class:onboarding-intro={step < last}>
    {#if step < last}
      <div class="onboarding-art" aria-hidden="true">
        {#if step === 0}<Mascot />
        {:else if step === 1}{#each [0, 1, 2] as i (i)}<Tomato
              variant="plan"
              size="xl"
            />{/each}
        {:else if step === 2}<Mascot phase="focus" />
        {:else}{#each recorded as variant, i (i)}<Tomato
              {variant}
              size="xl"
            />{/each}{/if}
      </div>
      <h2
        id="onboarding-title"
        class="onboarding-title"
        class:wave={step > 0}
        data-step-title
        tabindex="-1"
      >
        {#if step > 0}<Circ n={step} state="on" />{/if}{intro[step].title}
      </h2>
      {#each intro[step].body as line}<p class="onboarding-body">
          {line}
        </p>{/each}
    {:else}
      <h2
        id="onboarding-title"
        class="onboarding-title wave"
        data-step-title
        tabindex="-1"
      >
        계정
      </h2>
      {#if !account?.configured}
        <p class="onboarding-body">
          이 실행 환경에서는 계정 기능을 사용할 수 없습니다.
        </p>
      {:else if !account.user}
        <p class="onboarding-body">
          연동하면 다른 기기와 동기화되어 사용하실 수 있습니다.
        </p>
        <AuthForm id="onboarding" />
      {:else}
        <p class="onboarding-body">{account.user.email}</p>
        {#if !account.enabled}<p class="onboarding-body">
            연동하면 다른 기기와 동기화되어 사용하실 수 있습니다.
          </p>{/if}
      {/if}
    {/if}
    {#if error || (step === last && !account?.user && account?.error)}<p
        class="form-error"
        role="alert"
      >
        {error || account?.error}
      </p>{/if}
    </div>
    <div class="onboarding-footer">
      {#if step < last}
        <button
          type="button"
          class="text-button"
          disabled={busy}
          onclick={finish}>건너뛰기</button
        >
        <span class="onboarding-nav">
          {#if step > 0}<button
              type="button"
              class="btn-line"
              disabled={busy}
              onclick={() => go(step - 1)}>이전</button
            >{/if}<button
            type="button"
            class="primary"
            disabled={busy}
            onclick={() => go(step + 1)}>다음</button
          >
        </span>
      {:else}
        <button
          type="button"
          class="btn-line"
          disabled={busy}
          onclick={() => go(step - 1)}>이전</button
        >
        <span class="onboarding-nav">
          {#if !account?.configured || account.enabled}<button
              type="button"
              class="primary"
              disabled={busy}
              onclick={finish}>시작</button
            >
          {:else if !account.user}<button
              type="button"
              class="text-button"
              disabled={busy}
              onclick={finish}>로그인 없이 시작</button
            >
          {:else}<button
              type="button"
              class="text-button"
              disabled={busy}
              onclick={finish}>나중에</button
            ><button
              type="button"
              class="primary"
              disabled={busy}
              onclick={enable}>연동</button
            >{/if}
        </span>
      {/if}
    </div>
  </dialog>
{/if}
