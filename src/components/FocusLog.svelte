<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    listClips,
    readClip,
    deleteClip,
    weekBounds,
    logRevision,
    mediaError,
    type ClipSummary,
  } from '../lib/focus-log';
  import { downloadVideo } from '../lib/video';
  import {
    deliveries,
    deliveryWork,
    deliveryError,
    deliveryTime,
    readDelivery,
    markDeliverySeen,
    type Delivery,
  } from '../lib/deliveries';
  import { notify, now } from '../lib/client';
  import { localDate } from '../lib/domain.mjs';
  let week = $state(0),
    clips = $state<ClipSummary[]>([]),
    error = $state(''),
    loading = $state(true);
  let downloading = $state(false);
  let urls = $state<Record<string, string>>({}),
    preview = $state(''),
    previewTitle = $state('');
  let previewDialog: HTMLDialogElement;
  let previewRequest = 0;
  const today = $derived(localDate(new Date($now)));
  const bounds = $derived(weekBounds(week, new Date(today + 'T12:00:00')));
  const selected = $derived(
    clips.filter(
      (clip) =>
        clip.at >= bounds.start.getTime() && clip.at < bounds.end.getTime(),
    ),
  );
  const lastDay = $derived(new Date(bounds.end.getTime() - 1));
  const dayCount = $derived(
    new Set(selected.map((clip) => localDate(new Date(clip.at)))).size,
  );
  $effect(() => {
    $logRevision;
    let active = true;
    loading = true;
    listClips()
      .then((value) => {
        if (active) {
          clips = value;
          error = '';
          loading = false;
        }
      })
      .catch((cause) => {
        if (active) {
          error = mediaError(cause);
          loading = false;
        }
      });
    return () => {
      active = false;
    };
  });
  $effect(() => {
    const next = Object.fromEntries(
      selected.map((clip) => [clip.id, URL.createObjectURL(clip.thumbnail)]),
    );
    urls = next;
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url));
  });
  async function show(clip: ClipSummary) {
    const request = ++previewRequest;
    try {
      const value = await readClip(clip.id);
      if (request !== previewRequest) return;
      if (preview) URL.revokeObjectURL(preview);
      preview = URL.createObjectURL(value.blob);
      previewTitle = clip.taskTitle;
      previewDialog.showModal();
    } catch (cause) {
      error = mediaError(cause);
    }
  }
  function closePreview() {
    previewRequest++;
    if (preview) URL.revokeObjectURL(preview);
    preview = '';
    previewDialog.close();
  }
  async function remove(clip: ClipSummary) {
    if (!confirm('이 영상을 삭제합니다. 삭제한 영상은 복구할 수 없습니다.'))
      return;
    try {
      await deleteClip(clip.id);
      notify('영상을 삭제했습니다.');
    } catch (cause) {
      error = mediaError(cause);
    }
  }
  async function showDelivery(delivery: Delivery) {
    const request = ++previewRequest;
    try {
      const blob = await readDelivery(delivery.id);
      if (request !== previewRequest) return;
      if (preview) URL.revokeObjectURL(preview);
      preview = URL.createObjectURL(blob);
      previewTitle = '주간 영상';
      previewDialog.showModal();
      await markDeliverySeen(delivery.id);
    } catch (cause) {
      error = mediaError(cause);
    }
  }
  async function download(delivery: Delivery) {
    if (downloading) return;
    downloading = true;
    try {
      if (
        await downloadVideo(
          await readDelivery(delivery.id),
          `to3mato-${delivery.id}-${localDate(new Date(delivery.end - 1))}`,
        )
      )
        notify('영상을 다운로드했습니다.');
    } catch (cause) {
      error = mediaError(cause);
    } finally {
      downloading = false;
    }
  }
  onDestroy(() => {
    previewRequest++;
    if (preview) URL.revokeObjectURL(preview);
  });
</script>

<section class="focus-log" aria-labelledby="log-title">
  <div class="log-intro">
    <h1 id="log-title">집중 로그</h1>
    <p>집중 완료 후 촬영한 3초 영상을 주별로 모읍니다.</p>
  </div>
  <section class="delivery-inbox" aria-label="영상 편지함">
    <div class="delivery-schedule">
      <span aria-hidden="true">✉</span>
      <div>
        <strong>매주 월요일 오전 9시 배달</strong>
        <p>
          지난주 월요일부터 일요일까지 촬영한 영상을 한 편으로 만듭니다.<br />앱이
          꺼져 있었다면 다음 실행 시 만듭니다.
        </p>
      </div>
    </div>
    {#if $deliveryWork}<p class="delivery-progress" role="status">
        영상 만드는 중 {Math.round(
          $deliveryWork.progress * 100,
        )}%
      </p>
      <progress
        max="1"
        value={$deliveryWork.progress}
        aria-label="영상 편지 준비 진행률"
      ></progress>
      <p class="delivery-hint">완료될 때까지 창을 열어 두세요.</p>{/if}
    {#if $deliveryError}<p class="form-error" role="alert">
        {$deliveryError} 잠시 후 자동으로 다시 시도합니다.
      </p>{/if}
    {#each $deliveries as delivery (delivery.id)}
      <article class="delivery-card">
        {#if !delivery.seen}<div class="delivery-postmark">
            <span>NEW</span>
          </div>{/if}
        <h2>배달왔어요 🍅</h2>
        <p>
          {new Date(delivery.start).toLocaleDateString('ko-KR', {
            month: 'long',
            day: 'numeric',
          })} — {new Date(delivery.end - 1).toLocaleDateString('ko-KR', {
            month: 'long',
            day: 'numeric',
          })}<br />영상 {delivery.clipCount}개 · {Math.round(
            delivery.duration / 1000,
          )}초
        </p>
        <div class="delivery-actions">
          <button class="primary" onclick={() => showDelivery(delivery)}
            >영상 편지 보기</button
          ><button
            class="delivery-download"
            disabled={downloading}
            onclick={() => download(delivery)}>다운로드</button
          >
        </div>
      </article>
    {:else}{#if !$deliveryWork}<div class="delivery-waiting">
          <strong>다음 배달</strong>
          <p>
            {deliveryTime(
              weekBounds(0, new Date(today + 'T12:00:00')).end,
            ).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 월요일
            오전 9시
          </p>
        </div>{/if}{/each}
  </section>
  <div class="log-week">
    <button
      class="icon-button"
      aria-label="이전 기록 주"
      disabled={!!$deliveryWork}
      onclick={() => week--}>‹</button
    ><strong
      >{bounds.start.toLocaleDateString('ko-KR', {
        month: 'long',
        day: 'numeric',
      })} — {lastDay.toLocaleDateString('ko-KR', {
        month: 'long',
        day: 'numeric',
      })}</strong
    ><button
      class="icon-button"
      aria-label="다음 기록 주"
      disabled={week >= 0}
      onclick={() => week++}>›</button
    >
  </div>
  <div class="log-summary">
    <span
      >{dayCount}일 · 영상 {selected.length}개 · {selected.length *
        3}초</span
    >{#if week !== 0}<button
        disabled={!!$deliveryWork}
        onclick={() => (week = 0)}>이번 주</button
      >{/if}
  </div>
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {#if loading}<p role="status">불러오는 중</p>
  {:else if !selected.length}<div class="log-empty">
      <span>✳</span>
      <h2>이번 주 기록 없음</h2>
      <p>
        집중 타이머가 끝나면 촬영할 수 있습니다.
      </p>
    </div>
  {:else}<div class="log-grid">
      {#each selected as clip (clip.id)}<article class="moment-card">
          <button
            class="moment-play"
            aria-label={`${clip.taskTitle} 영상 보기`}
            onclick={() => show(clip)}
            ><img
              src={urls[clip.id]}
              alt={`${clip.taskTitle} 촬영 미리보기`}
            /><span class="play-mark">▷</span></button
          >
          <div class="moment-info">
            <time datetime={new Date(clip.at).toISOString()}
              >{new Date(clip.at).toLocaleDateString('ko-KR', {
                month: 'numeric',
                day: 'numeric',
                weekday: 'short',
              })} · {new Date(clip.at).toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
              })}</time
            >
            <p>{clip.taskTitle}</p>
            <button
              class="text-button"
              disabled={!!$deliveryWork}
              aria-label={`${clip.taskTitle} 영상 삭제`}
              onclick={() => remove(clip)}>삭제</button
            >
          </div>
        </article>{/each}
    </div>{/if}
  <p class="log-local">
    영상은 이 기기에 저장됩니다. 배달된 영상은 다운로드해 보관하세요.<br
    />설정의 JSON 백업에는 영상이 포함되지 않습니다.
  </p>
</section>
<dialog
  bind:this={previewDialog}
  aria-label="집중 기록 재생"
  oncancel={(event) => {
    event.preventDefault();
    closePreview();
  }}
>
  <div class="dialog-heading">
    <h2>{previewTitle}</h2>
    <button class="icon-button" aria-label="영상 닫기" onclick={closePreview}
      >✕</button
    >
  </div>
  {#if preview}<video
      class="log-preview"
      src={preview}
      controls
      autoplay
      muted
      playsinline
      aria-label={previewTitle}
    ></video>{/if}
</dialog>

<style>
  .delivery-inbox {
    margin-bottom: 30px;
  }
  .delivery-schedule {
    display: flex;
    gap: 13px;
    margin: 20px 0;
  }
  .delivery-schedule > span {
    font-size: 32px;
    color: var(--red);
  }
  .delivery-schedule strong {
    font-size: 19px;
    font-weight: 400;
  }
  .delivery-schedule p,
  .delivery-hint {
    font-size: 14px;
    color: var(--muted);
    line-height: 1.6;
    margin: 6px 0;
  }
  .delivery-card {
    background: #fff8e9;
    border: 1px solid #dfc9a9;
    border-radius: 12px;
    padding: 24px;
    margin: 14px 0;
    background-image: repeating-linear-gradient(
      135deg,
      transparent,
      transparent 8px,
      #cc715817 8px,
      #cc715817 16px
    );
    background-size: 100% 6px;
    background-repeat: no-repeat;
  }
  .delivery-postmark {
    display: flex;
    justify-content: space-between;
    font: 11px monospace;
    letter-spacing: 2px;
    color: var(--green);
  }
  .delivery-postmark span {
    letter-spacing: 0;
  }
  .delivery-card h2 {
    font-size: 30px;
    font-weight: 400;
    margin: 22px 0 8px;
  }
  .delivery-card p {
    font-size: 17px;
    color: var(--muted);
    line-height: 1.7;
  }
  .delivery-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 18px;
    margin-top: 20px;
  }
  .delivery-download {
    font-size: 17px;
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .delivery-waiting {
    border: 1px dashed #d6c5ab;
    border-radius: 12px;
    padding: 22px;
    text-align: center;
  }
  .delivery-waiting strong {
    font-size: 21px;
    font-weight: 400;
  }
  .delivery-waiting p {
    font-size: 16px;
    color: var(--muted);
    line-height: 1.7;
  }
  .delivery-progress {
    font-size: 18px;
    color: var(--green);
  }
  progress {
    width: 100%;
    accent-color: var(--red);
  }

  .log-intro {
    margin: 8px 0 28px;
  }
  .log-intro h1 {
    font-size: 30px;
    font-weight: 400;
    margin: 12px 0 8px;
  }
  .log-intro p,
  .log-local {
    color: var(--muted);
    font-size: 16px;
    line-height: 1.6;
  }
  .log-week {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-block: 1px solid var(--line);
    padding: 9px 0;
    gap: 4px;
  }
  .log-week strong {
    font-weight: 400;
    font-size: 20px;
  }
  .log-summary {
    display: flex;
    justify-content: space-between;
    font-size: 16px;
    color: var(--muted);
    margin: 17px 0;
  }
  .log-empty {
    padding: 40px 12px;
    text-align: center;
    border: 1px dashed var(--line);
    border-radius: 16px;
    background: var(--paper);
  }
  .log-empty > span {
    font-size: 42px;
    color: var(--red);
  }
  .log-empty h2 {
    font-size: 24px;
    font-weight: 400;
  }
  .log-empty p {
    color: var(--muted);
    line-height: 1.7;
    font-size: 17px;
  }
  .log-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px 14px;
  }
  .moment-card {
    padding: 8px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 9px;
  }
  .moment-play {
    display: block;
    position: relative;
    padding: 0;
    width: 100%;
    aspect-ratio: 3/4;
    overflow: hidden;
    border-radius: 5px;
    background: #30362b;
  }
  .moment-play img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .play-mark {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 40px;
    color: white;
    text-shadow: 0 2px 8px #0009;
  }
  .moment-info {
    padding: 10px 3px 4px;
  }
  .moment-info time {
    color: var(--muted);
    font-size: 13px;
  }
  .moment-info p {
    margin: 5px 0;
    overflow-wrap: anywhere;
    font-size: 18px;
  }
  .moment-info .text-button {
    font-size: 13px;
    padding: 3px 0;
  }
  .log-local {
    font-size: 13px;
    text-align: center;
  }
  .log-preview {
    width: 100%;
    max-height: 65dvh;
    border-radius: 10px;
  }
  @media (max-width: 480px) {
    .log-grid {
      grid-template-columns: 1fr;
    }
    .log-week strong {
      font-size: 16px;
    }
    .log-intro h1 {
      font-size: 26px;
    }
  }
</style>
