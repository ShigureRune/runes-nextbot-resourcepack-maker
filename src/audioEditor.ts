import { isOggVorbis } from './assetValidation.ts';

/** Keep decoding and encoding bounded on mobile devices. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;

export function normalizeDistortionAmount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
}

/** Copy a PCM chunk and add deliberate hard clipping without mutating the source. */
export function distortSamples(samples: Float32Array, amount: number): Float32Array {
  const normalized = normalizeDistortionAmount(amount);
  const output = new Float32Array(samples.length);
  if (normalized === 0) {
    output.set(samples);
    return output;
  }
  const drive = 1 + normalized * 0.18;
  for (let i = 0; i < samples.length; i++) {
    output[i] = Math.max(-1, Math.min(1, samples[i] * drive));
  }
  return output;
}

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

export async function decodeAudio(source: Blob, maxBytes = MAX_AUDIO_BYTES): Promise<AudioBuffer> {
  if (source.size === 0 || source.size > maxBytes) {
    throw new Error('音声ファイルの容量が上限を超えています。');
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
  distortionAmount = 0,
): Promise<Blob> {
  const { first, last } = sampleRange(range, decoded.duration, decoded.sampleRate);
  const distortion = normalizeDistortionAmount(distortionAmount);
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
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => {
        const samples = decoded.getChannelData(index).subarray(offset, end);
        return distortion > 0 ? distortSamples(samples, distortion) : samples;
      });
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


/** Decode only the audio track of a video, using native decoding first and
 * container demuxing + WebCodecs when the browser cannot decode the file directly. */
export async function decodeVideoAudio(source: Blob): Promise<AudioBuffer> {
  const maxBytes = 32 * 1024 * 1024;
  if (source.size < 1 || source.size > maxBytes) throw new Error('動画は32MiB以下にしてください。');
  try {
    return await decodeAudio(source, maxBytes);
  } catch (error) {
    if (error instanceof Error && /120秒|モノラル/.test(error.message)) throw error;
  }
  const { Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('この動画には音声トラックがありません。');
    const duration = await track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_SECONDS + 0.001) {
      throw new Error('動画の音声は120秒以内にしてください。');
    }
    const sink = new AudioBufferSink(track);
    let result: AudioBuffer | null = null;
    for await (const { buffer, timestamp } of sink.buffers(0, MAX_AUDIO_SECONDS)) {
      if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2 || buffer.sampleRate > 96000) {
        throw new Error('96kHz以下のモノラル・ステレオ音声に対応しています。');
      }
      if (!result) {
        result = new AudioBuffer({ length: Math.max(1, Math.ceil(Math.min(duration, MAX_AUDIO_SECONDS) * buffer.sampleRate)), sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels });
      }
      if (buffer.sampleRate !== result.sampleRate || buffer.numberOfChannels !== result.numberOfChannels) {
        throw new Error('途中で音声形式が変化する動画には対応していません。');
      }
      const offset = Math.round(timestamp * result.sampleRate);
      const from = Math.max(0, -offset);
      const to = Math.min(buffer.length, result.length - offset);
      if (to <= from) continue;
      for (let ch = 0; ch < result.numberOfChannels; ch++) {
        result.getChannelData(ch).set(buffer.getChannelData(ch).subarray(from, to), Math.max(0, offset));
      }
    }
    if (!result) throw new Error('動画に再生可能な音声がありません。');
    return result;
  } catch (error) {
    if (error instanceof Error && /音声トラック|120秒|モノラル|音声形式|再生可能/.test(error.message)) throw error;
    throw new Error('動画音声をデコードできません。MP4（AAC）などブラウザ対応の形式をお試しください。');
  } finally {
    input.dispose();
  }
}

/** A portable PCM preview; the original video stays unchanged. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const bytes = buffer.length * channels * 2;
  const data = new ArrayBuffer(44 + bytes);
  const view = new DataView(data);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, bytes, true);
  const samples = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const value = Math.max(-1, Math.min(1, samples[ch][i]));
      view.setInt16(44 + (i * channels + ch) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
  }
  return new Blob([data], { type: 'audio/wav' });
}
