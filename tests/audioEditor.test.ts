import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleRange, waveformPeaks, MAX_AUDIO_SECONDS } from '../src/audioEditor.ts';

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
  assert.deepEqual(waveformPeaks(new Float32Array([0, -0.5, 0.25, 1, 0.1, -0.1]), 3), [0.5, 1, 0.1]);
  assert.deepEqual(waveformPeaks(new Float32Array([]), 2), [0, 0]);
});
