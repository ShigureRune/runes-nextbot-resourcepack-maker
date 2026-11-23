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
