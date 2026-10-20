<script lang="ts">
  import { onMount } from 'svelte';
  import {
    deliveries,
    markDeliverySeen,
    startDeliveries,
    type Delivery,
  } from '../lib/deliveries';
  import { capturePrompt } from '../lib/focus-log';
  import { notify } from '../lib/client';
  let { onopen }: { onopen: () => void } = $props();
  const arrived = $derived($deliveries.find((delivery) => !delivery.seen));
  onMount(startDeliveries);
  async function dismiss(item: Delivery) {
    try {
      await markDeliverySeen(item.id);
    } catch {
      notify('읽음 상태를 저장하지 못했습니다.');
    }
  }
</script>

{#if arrived && !$capturePrompt}
  <section class="delivery-toast" aria-label="주간 영상 배달">
    <span class="parcel" aria-hidden="true">✉</span>
    <div aria-live="polite">
      <strong>배달왔어요 🍅</strong>
      <p>지난주 집중 로그 영상이 준비됐습니다.</p>
      <button
        class="primary"
        onclick={() => {
          onopen();
          void dismiss(arrived);
        }}>영상 보기</button
      >
    </div>
    <button
      class="icon-button"
      aria-label="배달 알림 닫기"
      onclick={() => dismiss(arrived)}>✕</button
    >
  </section>
{/if}

<style>
  .delivery-toast {
    position: fixed;
    z-index: 9;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    display: flex;
    align-items: flex-start;
    gap: 16px;
    width: min(530px, calc(100vw - 32px));
    background: #fff8e9;
    border: 1px solid #d8b98d;
    border-radius: 18px;
    padding: 22px;
    box-shadow: 0 10px 40px #343a3026;
  }
  .parcel {
    font-size: 44px;
    color: var(--red);
  }
  strong {
    font-size: 26px;
    font-weight: 400;
  }
  p {
    font-size: 17px;
    color: var(--muted);
    margin: 7px 0 16px;
    line-height: 1.5;
  }
  .icon-button {
    flex-shrink: 0;
    margin-left: auto;
  }
</style>
