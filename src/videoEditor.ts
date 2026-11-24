import { processPng } from './imageEditor.ts';
import type { ImageEditSettings } from './imageEditor.ts';
import { applyVisualEffectsFramePng, hasAnimatedVisualEffects, defaultVisualEffectSettings } from './visualEffects.ts';
import type { VisualEffectSettings } from './visualEffects.ts';

/** Stage 09: browser-native video metadata validation and PNG frame capture. */
export const MAX_VIDEO_BYTES = 32 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 120;
export interface VideoInfo { width: number; height: number; duration: number }
export function isVideoFilename(name: string): boolean {
  return /\.(mp4|m4v|webm|mov)$/i.test(name);
}
export function assertVideoInfo(info: VideoInfo): VideoInfo {
  const { width, height, duration } = info;
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > 1920 || height > 1920 || width * height > 1920 * 1080) {
    throw new Error('動画は各辺1920px以下、合計約207万画素以下にしてください。');
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_SECONDS) {
    throw new Error('動画は120秒以内で、再生時間が読み取れるものを選んでください。');
  }
  return info;
}
export function frameTime(time: number, duration: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0 ||
      time < 0 || time > duration + 0.01) {
    throw new RangeError('動画の再生位置は0秒から再生時間の範囲内にしてください。');
  }
  return Math.min(time, Math.max(0, duration - 0.001));
}
export async function inspectVideo(file: Blob, name: string): Promise<VideoInfo> {
  if (!isVideoFilename(name)) throw new Error('MP4、WebM、MOVの動画を選んでください。');
  if (file.size < 1 || file.size > MAX_VIDEO_BYTES) throw new Error('動画は32MiB以下にしてください。');
  const video = document.createElement('video');
  video.preload = 'metadata'; video.muted = true; video.playsInline = true;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<VideoInfo>((resolve, reject) => {
      let finished = false;
      const timer = setTimeout(() => finish(undefined, new Error('動画の読み込みがタイムアウトしました。')), 15000);
      function finish(info?: VideoInfo, error?: Error): void {
        if (finished) return;
        finished = true; clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        if (info) resolve(info);
        else reject(error ?? new Error('動画を読み込めませんでした。'));
      }
      function onLoaded(): void {
        try {
          finish(assertVideoInfo({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }));
        } catch (error) {
          finish(undefined, error instanceof Error ? error : new Error('動画の情報を取得できません。'));
        }
      }
      function onError(): void {
        finish(undefined, new Error('動画を読み込めません。ブラウザが映像形式に対応しているか確認してください。'));
      }
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      video.src = url; video.load();
    });
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
/** Seek to the selected second and obtain a real decoded still frame as PNG. */
export async function captureVideoFrame(video: HTMLVideoElement, time: number): Promise<Blob> {
  const { width, height, duration } = assertVideoInfo({
    width: video.videoWidth, height: video.videoHeight, duration: video.duration,
  });
  const target = frameTime(time, duration);
  video.pause();
  if (video.seeking || Math.abs(video.currentTime - target) > 0.002) {
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => finish(new Error('動画の位置移動がタイムアウトしました。')), 15000);
      const onSeek = () => finish();
      const onError = () => finish(new Error('動画を指定位置へ移動できませんでした。'));
      function finish(error?: Error): void {
        if (done) return;
        done = true; clearTimeout(timer);
        video.removeEventListener('seeked', onSeek);
        video.removeEventListener('error', onError);
        if (error) reject(error); else resolve();
      }
      video.addEventListener('seeked', onSeek);
      video.addEventListener('error', onError);
      try {
        video.currentTime = target;
        if (!video.seeking && Math.abs(video.currentTime - target) < 0.002 &&
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error('動画の位置を変更できません。'));
      }
    });
  }
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => finish(new Error('フレームのデコードがタイムアウトしました。')), 15000);
      const onLoad = () => finish();
      const onError = () => finish(new Error('動画フレームをデコードできませんでした。'));
      function finish(error?: Error): void {
        if (done) return;
        done = true; clearTimeout(timer);
        video.removeEventListener('loadeddata', onLoad);
        video.removeEventListener('error', onError);
        if (error) reject(error); else resolve();
      }
      video.addEventListener('loadeddata', onLoad);
      video.addEventListener('error', onError);
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish();
    });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2Dが使えません。');
  context.drawImage(video, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNGの生成に失敗しました。')), 'image/png');
  });
}


export const MAX_VIDEO_ANIMATION_FRAMES = 24;
export interface VideoAnimationRange { start: number; end: number; count: number }

/** Quantize the chosen interval to Minecraft's 50 ms ticks, preserving its total duration. */
export function videoAnimationPlan(range: VideoAnimationRange, duration: number): Array<{ time: number; ticks: number }> {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) || range.start < 0 || range.end > duration + 0.001 ||
      range.end - range.start < 0.1 - 1e-9 ||
      !Number.isInteger(range.count) || range.count < 2 || range.count > MAX_VIDEO_ANIMATION_FRAMES) {
    throw new RangeError('開始・終了秒（0.1秒以上）とフレーム数（2〜24）を確認してください。');
  }
  const length = Math.min(range.end, duration) - range.start;
  const totalTicks = Math.max(2, Math.round(length * 20));
  const count = Math.min(range.count, totalTicks);
  return Array.from({ length: count }, (_, index) => ({
    time: frameTime(range.start + length * index / count, duration),
    ticks: Math.round((index + 1) * totalTicks / count) - Math.round(index * totalTicks / count),
  }));
}

function checkVideoAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('動画の処理をキャンセルしました。', 'AbortError');
}

/** Use a separate decoder so seeking for export never changes the visible video preview. */
export async function processVideoAnimation(
  source: Blob, settings: ImageEditSettings, range: VideoAnimationRange,
  onProgress?: (fraction: number) => void, signal?: AbortSignal,
  effects: VisualEffectSettings = defaultVisualEffectSettings(),
): Promise<{ png: Blob; previewPng: Blob; animationMcmeta: string; frameCount: number }> {
  checkVideoAbort(signal);
  if (source.size < 1 || source.size > MAX_VIDEO_BYTES) throw new Error('動画は32MiB以下にしてください。');
  const video = document.createElement('video');
  video.preload = 'auto'; video.muted = true; video.playsInline = true;
  const url = URL.createObjectURL(source);
  try {
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => finish(new Error('動画の読み込みがタイムアウトしました。')), 15000);
      const onLoad = () => finish();
      const onError = () => finish(new Error('動画を読み込めません。'));
      const onAbort = () => finish(new DOMException('動画の処理をキャンセルしました。', 'AbortError'));
      function finish(error?: Error): void {
        if (done) return;
        done = true; clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onLoad);
        video.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve();
      }
      video.addEventListener('loadedmetadata', onLoad);
      video.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      video.src = url; video.load();
    });
    const info = assertVideoInfo({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
    const plan = videoAnimationPlan(range, info.duration);
    const size = settings.resolution;
    const sprite = document.createElement('canvas');
    sprite.width = size; sprite.height = size * plan.length;
    const ctx = sprite.getContext('2d');
    if (!ctx) throw new Error('Canvas 2Dが使えません。');
    let poster: Blob | null = null;
    for (let index = 0; index < plan.length; index++) {
      checkVideoAbort(signal);
      const still = await captureVideoFrame(video, plan[index].time);
      checkVideoAbort(signal);
      const bitmap = await createImageBitmap(still);
      let png: Blob;
      try { png = await processPng(bitmap, settings); } finally { bitmap.close(); }
      checkVideoAbort(signal);
      if (hasAnimatedVisualEffects(effects)) png = await applyVisualEffectsFramePng(png, index / plan.length, effects);
      if (!poster) poster = png;
      const output = await createImageBitmap(png);
      try {
        checkVideoAbort(signal);
        ctx.drawImage(output, 0, size * index);
      } finally { output.close(); }
      onProgress?.((index + 1) / plan.length);
    }
    if (!poster) throw new Error('動画フレームを取得できませんでした。');
    const png = await new Promise<Blob>((resolve, reject) => {
      sprite.toBlob(blob => blob ? resolve(blob) : reject(new Error('アニメーションPNGを生成できません。')), 'image/png');
    });
    checkVideoAbort(signal);
    return {
      png, previewPng: poster, frameCount: plan.length,
      animationMcmeta: JSON.stringify({ animation: { frametime: 1, frames: plan.map((frame, index) => ({ index, time: frame.ticks })) } }, null, 2),
    };
  } finally {
    video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  }
}
