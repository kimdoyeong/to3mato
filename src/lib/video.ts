import { readClip, type ClipSummary, type Moment } from './focus-log';

export function recordingType() {
  if (typeof MediaRecorder === 'undefined')
    throw new Error(
      '이 환경에서는 영상 녹화를 지원하지 않습니다. 최신 Chrome 또는 데스크톱 앱을 사용하세요.',
    );
  const type = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ].find((value) => MediaRecorder.isTypeSupported(value));
  if (!type)
    throw new Error(
      '지원되는 영상 형식이 없습니다. 최신 Chrome 또는 데스크톱 앱을 사용하세요.',
    );
  return type;
}
export function abortError() {
  return new DOMException('취소했습니다.', 'AbortError');
}
export function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export function videoReady(video: HTMLVideoElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    };
    const loaded = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error('영상을 읽을 수 없습니다. 다시 시도하세요.'));
    };
    const aborted = () => {
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(failed, 15000);
    video.addEventListener('loadeddata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    if (video.readyState >= 2) loaded();
  });
}
export function drawMoment(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  moment: Moment,
) {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
  const vw = video.videoWidth * scale,
    vh = video.videoHeight * scale;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.filter = 'saturate(0.8) contrast(0.95) sepia(0.12)';
  ctx.drawImage(video, (w - vw) / 2, (h - vh) / 2, vw, vh);
  ctx.restore();
  const shade = ctx.createLinearGradient(0, h * 0.55, 0, h);
  shade.addColorStop(0, 'transparent');
  shade.addColorStop(1, '#161b16bb');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff9ed';
  ctx.font = '16px monospace';
  ctx.fillText('to3mato / little moments', 30, 40);
  ctx.font = '22px monospace';
  const date = new Date(moment.at);
  ctx.fillText(
    date.toLocaleDateString('sv-SE') +
      '  ' +
      date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    30,
    h - 90,
  );
  ctx.font = '26px sans-serif';
  let title = moment.taskTitle;
  while (title.length > 1 && ctx.measureText(title).width > w - 65)
    title = title.slice(0, -2) + '…';
  ctx.fillText(title, 30, h - 46);
}
export function thumbnail(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('미리보기를 만들지 못했습니다.')),
      'image/jpeg',
      0.8,
    ),
  );
}
// Encode one continuous stream; concatenating independent WebM blobs produces an invalid montage.
export async function recordCanvas(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  produce: (recorder: MediaRecorder) => Promise<void>,
) {
  signal.throwIfAborted();
  const stream = canvas.captureStream(30);
  let recorder: MediaRecorder | undefined;
  const chunks: Blob[] = [];
  let failure: unknown;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: recordingType(),
      videoBitsPerSecond: 2_500_000,
    });
    const active = recorder;
    const stopped = new Promise<void>((resolve) => {
      active.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      active.onstop = () => resolve();
      active.onerror = () => {
        failure = new Error('영상 인코딩에 실패했습니다. 다시 시도하세요.');
        if (active.state !== 'inactive') active.stop();
        else resolve();
      };
    });
    active.start(100);
    try {
      await produce(active);
    } catch (error) {
      failure = error;
    }
    if (active.state !== 'inactive') active.stop();
    await stopped;
    if (failure) throw failure;
    signal.throwIfAborted();
    const blob = new Blob(chunks, { type: active.mimeType });
    if (!blob.size) throw new Error('영상이 비어 있습니다. 다시 촬영하세요.');
    return blob;
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
  }
}
export async function exportWeek(
  clips: ClipSummary[],
  signal: AbortSignal,
  progress: (value: number) => void,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 960;
  const context = canvas.getContext('2d')!;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  let url = '',
    frame = 0;
  async function load(index: number) {
    signal.throwIfAborted();
    const clip = await readClip(clips[index].id);
    signal.throwIfAborted();
    url = URL.createObjectURL(clip.blob);
    video.src = url;
    await videoReady(video, signal);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return clip;
  }
  try {
    let clip = await load(0);
    return await recordCanvas(canvas, signal, async (recorder) => {
      for (let index = 0; index < clips.length; index++) {
        if (index > 0) clip = await load(index);
        signal.throwIfAborted();
        await video.play();
        const draw = () => {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          frame = requestAnimationFrame(draw);
        };
        draw();
        if (recorder.state === 'paused') recorder.resume();
        await wait(clip.duration, signal);
        if (recorder.state === 'recording') recorder.pause();
        cancelAnimationFrame(frame);
        video.pause();
        URL.revokeObjectURL(url);
        url = '';
        progress((index + 1) / clips.length);
      }
    });
  } finally {
    cancelAnimationFrame(frame);
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (url) URL.revokeObjectURL(url);
  }
}
export async function downloadVideo(blob: Blob, name: string) {
  const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
  if (window.to3mato)
    return window.to3mato.exportVideo(
      await blob.arrayBuffer(),
      `${name}.${extension}`,
    );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}.${extension}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
