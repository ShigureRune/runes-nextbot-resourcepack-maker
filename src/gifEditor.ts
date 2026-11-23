import { parseGIF, decompressFrames } from 'gifuct-js';
import { processPng } from './imageEditor.ts';
import type { ImageEditSettings } from './imageEditor.ts';

export const MAX_GIF_BYTES = 8 * 1024 * 1024;
export const MAX_GIF_FRAMES = 24;
export interface GifInfo { width: number; height: number; count: number; }
export interface GifFrameRange { first: number; last: number; } // 1-based, inclusive

export function validFrameRange(range: GifFrameRange, total: number): boolean {
  return Number.isInteger(range.first) && Number.isInteger(range.last) &&
    range.first >= 1 && range.first <= range.last && range.last <= total;
}
export function frameTicks(delayMs: number): number {
  // Minecraft texture animation timing is in 50ms game ticks.
  return Math.max(1, Math.min(200, Math.round((Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 100) / 50)));
}
export function inspectGif(source: Blob): Promise<GifInfo> {
  return parseGif(source).then(({ width, height, frames }) => ({ width, height, count: frames.length }));
}
async function parseGif(source: Blob) {
  if (source.size < 15 || source.size > MAX_GIF_BYTES) {
    throw new Error('GIFは8MiB以下のファイルを選択してください。');
  }
  const bytes = await source.arrayBuffer();
  const header = new TextDecoder().decode(bytes.slice(0, 6));
  if (header !== 'GIF89a' && header !== 'GIF87a') throw new Error('GIFファイルの形式が正しくありません。');
  const gif = parseGIF(bytes);
  const width = gif.lsd.width, height = gif.lsd.height;
  if (width < 1 || height < 1 || width > 512 || height > 512 || width * height > 262144) {
    throw new Error('GIFは512×512px以下にしてください。');
  }
  // Check frame count before decoding patches: a tiny file may contain thousands of frames.
  const frameCount = gif.frames.filter(frame => 'image' in frame).length;
  if (!frameCount || frameCount > MAX_GIF_FRAMES) {
    throw new Error('GIFのフレーム数は1〜24枚にしてください。');
  }
  const frames = decompressFrames(gif, true);
  return { width, height, frames };
}
function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(new Error('アニメーションPNGを書き出せませんでした。')), 'image/png'));
}

/** Composite GIF disposal methods before applying the same image crop/chroma to every frame. */
export async function processGif(
  source: Blob, settings: ImageEditSettings, range: GifFrameRange,
  onProgress?: (fraction: number) => void,
): Promise<{ png: Blob; previewPng: Blob; animationMcmeta: string; frameCount: number }> {
  const { width, height, frames } = await parseGif(source);
  if (!validFrameRange(range, frames.length)) throw new RangeError('GIFの開始・終了フレームを確認してください。');
  const count = range.last - range.first + 1;
  const resolution = settings.resolution;
  const composed = document.createElement('canvas');
  composed.width = width; composed.height = height;
  const ctx = composed.getContext('2d', { willReadFrequently: true });
  const sprite = document.createElement('canvas');
  sprite.width = resolution; sprite.height = resolution * count;
  const spriteCtx = sprite.getContext('2d');
  if (!ctx || !spriteCtx) throw new Error('Canvasを利用できません。');
  let previous: (typeof frames)[number] | null = null;
  let previousSaved: ImageData | null = null;
  let poster: Blob | null = null;
  const timings: Array<{ index: number; time: number }> = [];
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    if (previous?.disposalType === 2) {
      ctx.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
    } else if (previous?.disposalType === 3 && previousSaved) {
      ctx.putImageData(previousSaved, 0, 0);
    }
    previousSaved = frame.disposalType === 3 ? ctx.getImageData(0, 0, width, height) : null;
    const patch = document.createElement('canvas');
    patch.width = frame.dims.width; patch.height = frame.dims.height;
    const patchCtx = patch.getContext('2d');
    if (!patchCtx) throw new Error('GIFフレームの描画に失敗しました。');
    patchCtx.putImageData(new ImageData(new Uint8ClampedArray(frame.patch), patch.width, patch.height), 0, 0);
    ctx.drawImage(patch, frame.dims.left, frame.dims.top);
    if (index + 1 >= range.first && index + 1 <= range.last) {
      const bitmap = await createImageBitmap(composed);
      try {
        const processed = await processPng(bitmap, settings);
        if (!poster) poster = processed;
        const outputFrame = await createImageBitmap(processed);
        try {
          const frameIndex = index + 1 - range.first;
          spriteCtx.drawImage(outputFrame, 0, frameIndex * resolution);
          timings.push({ index: frameIndex, time: frameTicks(frame.delay) });
        } finally { outputFrame.close(); }
      } finally { bitmap.close(); }
      onProgress?.(timings.length / count);
    }
    previous = frame;
  }
  if (!poster) throw new Error('GIFのフレームを生成できませんでした。');
  return {
    png: await canvasPng(sprite), previewPng: poster,
    animationMcmeta: JSON.stringify({ animation: { frametime: 1, frames: timings } }, null, 2),
    frameCount: count,
  };
}
