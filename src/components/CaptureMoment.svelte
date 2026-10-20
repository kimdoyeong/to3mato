<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import {
    capturePrompt,
    saveClip,
    mediaError,
    type Moment,
    type Clip,
  } from '../lib/focus-log';
  import { notify } from '../lib/client';
  import {
    recordingType,
    videoReady,
    drawMoment,
    recordCanvas,
    thumbnail,
    wait,
  } from '../lib/video';

  let dialog: HTMLDialogElement;
  let video: HTMLVideoElement;
  let canvas: HTMLCanvasElement;
  let phase = $state<
    'opening' | 'countdown' | 'recording' | 'saving' | 'error'
  >('opening');
  let count = $state(3),
    error = $state('');
  let moment = $state<Moment | null>(null);
  let unsaved = $state<Clip | null>(null);
  let stream: MediaStream | undefined;
  let controller: AbortController | undefined;
  let frame = 0;
  function stopCamera() {
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    if (video) video.srcObject = null;
  }
  function close() {
    if (phase === 'saving') return;
    controller?.abort();
    stopCamera();
    dialog.close();
    moment = null;
    unsaved = null;
  }
  async function store() {
    if (!unsaved) return;
    phase = 'saving';
    error = '';
    try {
      await saveClip(unsaved);
      unsaved = null;
      dialog.close();
      moment = null;
      notify('저장했습니다. 집중 로그에서 볼 수 있습니다.');
    } catch (cause) {
      phase = 'error';
      error = mediaError(cause);
    }
  }
  async function shoot(selected: Moment) {
    moment = selected;
    capturePrompt.set(null);
    phase = 'opening';
    error = '';
    unsaved = null;
    controller?.abort();
    const current = new AbortController();
    controller = current;
    await tick();
    if (!dialog.open) dialog.showModal();
    try {
      recordingType();
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          '이 환경에서는 카메라에 접근할 수 없습니다. HTTPS 또는 데스크톱 앱에서 여세요.',
        );
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });
      if (current.signal.aborted) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      acquired.getVideoTracks().forEach((track) =>
        track.addEventListener(
          'ended',
          () => {
            if (controller !== current || current.signal.aborted) return;
            current.abort();
            stopCamera();
            phase = 'error';
            error =
              '카메라 연결이 끊겼습니다. 연결을 확인하고 다시 촬영하세요.';
          },
          { once: true },
        ),
      );
      video.srcObject = acquired;
      await videoReady(video, current.signal);
      await video.play();
      const draw = () => {
        drawMoment(canvas, video, selected);
        frame = requestAnimationFrame(draw);
      };
      draw();
      phase = 'countdown';
      for (count = 3; count > 0; count--) await wait(1000, current.signal);
      phase = 'recording';
      count = 3;
      const blob = await recordCanvas(canvas, current.signal, async () => {
        for (count = 3; count > 0; count--) await wait(1000, current.signal);
      });
      const poster = await thumbnail(canvas);
      current.signal.throwIfAborted();
      unsaved = { ...selected, duration: 3000, blob, thumbnail: poster };
      stopCamera();
      await store();
    } catch (cause) {
      if (!current.signal.aborted) {
        phase = 'error';
        error = mediaError(cause);
      }
    } finally {
      if (controller === current) stopCamera();
    }
  }
  function onVisibility() {
    if (
      document.hidden &&
      dialog?.open &&
      ['opening', 'countdown', 'recording'].includes(phase)
    ) {
      controller?.abort();
      stopCamera();
      phase = 'error';
      error = '촬영이 중단됐습니다. 이 창을 열어 둔 상태로 다시 촬영하세요.';
    }
  }
  onDestroy(() => {
    controller?.abort();
    stopCamera();
  });
</script>

<svelte:document onvisibilitychange={onVisibility} />
{#if $capturePrompt}
  <section class="capture-toast" aria-label="인증샷 제안">
    <div aria-live="polite">
      <strong>인증샷을 남길까요?</strong>
    </div>
    <div class="capture-toast-actions">
      <button class="text-button" onclick={() => capturePrompt.set(null)}
        >건너뛰기</button
      >
      <button
        class="primary"
        onclick={() => $capturePrompt && shoot($capturePrompt)}
        >촬영</button
      >
    </div>
  </section>
{/if}
<dialog
  class="capture-dialog"
  bind:this={dialog}
  aria-labelledby="capture-title"
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
>
  <div class="dialog-heading">
    <h2 id="capture-title">3초 촬영</h2>
    <button
      class="icon-button"
      aria-label="촬영 닫기"
      disabled={phase === 'saving'}
      onclick={close}>✕</button
    >
  </div>
  <div class="camera-frame">
    <video
      bind:this={video}
      muted
      playsinline
      aria-label="카메라 원본"
      class="camera-source"
    ></video>
    <canvas
      bind:this={canvas}
      width="720"
      height="960"
      aria-label="날짜와 할 일 이름이 담긴 촬영 미리보기"
    ></canvas>
    {#if phase === 'opening'}<div class="camera-overlay">
        카메라 준비 중
      </div>{/if}
    {#if phase === 'countdown'}<div class="camera-count">{count}</div>{/if}
    {#if phase === 'recording'}<div class="recording-badge">
        ● REC · {count}초
      </div>{/if}
  </div>
  <p class="capture-caption" role="status">
    {phase === 'countdown'
      ? '카운트다운 후 3초 동안 촬영합니다.'
      : phase === 'recording'
        ? '촬영 중'
        : phase === 'saving'
          ? '저장 중'
          : '마이크는 사용하지 않습니다. 영상은 이 기기에만 저장됩니다.'}
  </p>
  {#if error}<p class="form-error" role="alert">{error}</p>
    <button
      class="primary"
      onclick={() => (unsaved ? store() : moment && shoot(moment))}
      >{unsaved ? '저장 다시 시도' : '다시 촬영'}</button
    >{/if}
</dialog>

<style>
  .capture-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    width: min(550px, calc(100vw - 32px));
    padding: 20px 24px;
    background: var(--paper);
    border: 1px solid var(--red);
    border-radius: 18px;
    box-shadow: 0 10px 40px #343a3026;
  }
  .capture-toast strong {
    font-size: 24px;
  }
  .capture-toast-actions {
    margin-top: 16px;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 16px;
  }
  .capture-toast-actions .text-button {
    font-size: 16px;
  }
  .capture-dialog {
    width: 420px;
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
  }
  .camera-frame {
    position: relative;
    aspect-ratio: 3/4;
    max-height: 52dvh;
    margin: auto;
    background: #272b26;
    overflow: hidden;
    border-radius: 12px;
  }
  canvas {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .camera-source {
    display: none;
  }
  .camera-overlay,
  .camera-count {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #fff9ed;
  }
  .camera-count {
    font:
      80px Georgia,
      serif;
    background: #0002;
  }
  .recording-badge {
    position: absolute;
    top: 40px;
    right: 16px;
    background: #aa392e;
    color: white;
    border-radius: 20px;
    padding: 7px 12px;
  }
  .capture-caption {
    font-size: 16px;
    color: var(--muted);
    line-height: 1.5;
  }
</style>
