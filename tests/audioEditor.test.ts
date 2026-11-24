import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleRange, waveformPeaks, MAX_AUDIO_SECONDS, normalizeDistortionAmount, distortSamples, audioBufferToWav } from '../src/audioEditor.ts';

test('audio sample range converts seconds to frame boundaries', () => {
  assert.deepEqual(sampleRange({ start: 0.25, end: 1.5 }, 2, 48000), { first: 12000, last: 72000 });
  assert.deepEqual(sampleRange({ start: 0, end: 2 }, 2, 44100), { first: 0, last: 88200 });
});
test('invalid, reversed and out-of-bounds audio ranges are rejected', () => {
  for (const [start, end] of [[-1, 1], [1, 1], [2, 1], [0, 3], [NaN, 1], [0, Infinity]]) {
    assert.throws(() => sampleRange({ start, end }, 2, 44100), RangeError);
  }
  assert.throws(() => sampleRange({ start: 0, end: MAX_AUDIO_SECONDS + 1 }, MAX_AUDIO_SECONDS + 5, 44100), RangeError);
});
test('waveform peaks are bounded, per-column magnitudes', () => {
  assert.deepEqual(waveformPeaks(new Float32Array([0, -0.5, 0.25, 1, 0.1, -0.1]), 3).map(x => Number(x.toFixed(2))), [0.5, 1, 0.1]);
  assert.deepEqual(waveformPeaks(new Float32Array([]), 2), [0, 0]);
});


test('sound distortion normalizes strength and hard-clips a copied PCM buffer', () => {
  assert.equal(normalizeDistortionAmount(-20), 0);
  assert.equal(normalizeDistortionAmount(54.6), 55);
  assert.equal(normalizeDistortionAmount(500), 100);
  assert.equal(normalizeDistortionAmount('25'), 25);
  const source = new Float32Array([0.02, 0.2, -0.2, 0.9, -0.9]);
  const clean = distortSamples(source, 0);
  assert.deepEqual([...clean], [...source]);
  assert.notEqual(clean, source);
  const crushed = distortSamples(source, 100);
  assert.equal(crushed[3], 1);
  assert.equal(crushed[4], -1);
  assert.ok(crushed[1] > source[1]);
  assert.ok(Math.abs(source[3] - 0.9) < 1e-6);
});

test('video audio preview writes valid interleaved PCM WAV', async () => {
  const left = new Float32Array([-1, 0.5]), right = new Float32Array([1, 0]);
  const wav = audioBufferToWav({ numberOfChannels: 2, sampleRate: 48000, length: 2, getChannelData: (i: number) => i ? right : left } as AudioBuffer);
  const bytes = await wav.arrayBuffer();
  const data = new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), 'WAVE');
  assert.equal(data.getUint16(22, true), 2);
  assert.equal(data.getUint32(24, true), 48000);
  assert.equal(data.getUint32(40, true), 8);
  assert.equal(data.getInt16(44, true), -32768);
  assert.equal(data.getInt16(46, true), 32767);
  assert.equal(data.getInt16(48, true), 16384);
  assert.equal(data.getInt16(50, true), 0);
});
