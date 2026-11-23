import { isOggVorbis } from './assetValidation.ts';

/** Keep decoding and encoding bounded on mobile devices. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;

export interface AudioRange { start: number; end: number; }
export function sampleRange(range: AudioRange, duration: number, sampleRate: number): { first: number; last: number } {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || !Number.isFinite(duration) ||
      !Number.isFinite(sampleRate) || sampleRate <= 0 ||
      range.start < 0 || range.end <= range.start || range.end > duration + 0.01) {
    throw new RangeError('開始・終了位置を音声の長さの範囲内で指定してください。');
  }
  if (range.end - range.start > MAX_AUDIO_SECONDS) {
    throw new RangeError('一度に処理できるのは120秒までです。');
  }
  const first = Math.max(0, Math.floor(range.start * sampleRate));
  const last = Math.min(Math.round(duration * sampleRate), Math.ceil(range.end * sampleRate));
  if (last <= first) throw new RangeError('切り抜き範囲が短すぎます。');
  return { first, last };
}

/** A short, non-rendering helper that can be exercised by Node tests. */
export function waveformPeaks(samples: Float32Array, columns: number): number[] {
  const width = Math.max(1, Math.min(1024, Math.floor(columns)));
  const result: number[] = [];
  for (let x = 0; x < width; x++) {
    const from = Math.floor(x * samples.length / width);
    const to = Math.min(samples.length, Math.max(from + 1, Math.ceil((x + 1) * samples.length / width)));
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
    result.push(Math.min(1, peak));
  }
  return result;
}

export async function decodeAudio(source: Blob): Promise<AudioBuffer> {
  if (source.size === 0 || source.size > MAX_AUDIO_BYTES) {
    throw new Error('音声ファイルは20MiB以下にしてください。');
  }
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await source.arrayBuffer());
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > MAX_AUDIO_SECONDS) {
      throw new Error('音声は120秒以内のファイルを選択してください。');
    }
    if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2) {
      throw new Error('モノラル・ステレオ音声だけに対応しています。');
    }
    return buffer;
  } catch (cause) {
    if (cause instanceof Error && (cause.message.includes('120秒') || cause.message.includes('モノラル'))) throw cause;
    throw new Error('このブラウザで音声をデコードできません。形式やブラウザの対応を確認してください。');
  } finally {
    await context.close();
  }
}

/** Real Vorbis encoding (not renaming audio to .ogg). Never changes the source Blob. */
export async function encodeVorbisRange(
  decoded: AudioBuffer, range: AudioRange, onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const { first, last } = sampleRange(range, decoded.duration, decoded.sampleRate);
  const { default: ogg } = await import('@audio/encode-ogg');
  const encoder = await ogg({ sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, quality: 4 });
  const pages: ArrayBuffer[] = [];
  const append = (bytes: Uint8Array) => {
    if (bytes.byteLength) {
      // The WASM encoder can reuse its internal output buffer; copy every page.
      const copy = new Uint8Array(bytes);
      pages.push(copy.buffer as ArrayBuffer);
    }
  };
  try {
    const step = 4096;
    for (let offset = first; offset < last; offset += step) {
      const end = Math.min(last, offset + step);
      const channels = Array.from({ length: decoded.numberOfChannels },
        (_, index) => decoded.getChannelData(index).subarray(offset, end));
      append(encoder.encode(channels));
      if ((offset - first) % (step * 16) === 0) onProgress?.((offset - first) / (last - first));
    }
    append(encoder.flush());
    const result = new Blob(pages, { type: 'audio/ogg' });
    if (!(await isOggVorbis(result))) throw new Error('OGG Vorbis検証に失敗しました。元の音声は保持されています。');
    onProgress?.(1);
    return result;
  } finally {
    encoder.free();
  }
}
