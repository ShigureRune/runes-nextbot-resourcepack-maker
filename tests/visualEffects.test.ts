import assert from 'node:assert/strict';
import test from 'node:test';
import { gamingHueShift, GAMING_FRAME_COUNT, GAMING_FRAME_TICKS } from '../src/visualEffects.ts';

test('gaming hue rotates RGB while preserving alpha', () => {
  const red = new Uint8ClampedArray([255, 0, 0, 123]);
  gamingHueShift(red, 1 / 3);
  assert.ok(red[1] > 240);
  assert.ok(red[0] < 20 && red[2] < 20);
  assert.equal(red[3], 123);
});

test('gaming also colorizes neutral midtones and keeps transparent pixels untouched', () => {
  const first = new Uint8ClampedArray([128, 128, 128, 255, 10, 20, 30, 0]);
  const second = new Uint8ClampedArray(first);
  gamingHueShift(first, 0);
  gamingHueShift(second, 0.5);
  assert.notDeepEqual([...first.slice(0, 3)], [...second.slice(0, 3)]);
  assert.deepEqual([...first.slice(4)], [10, 20, 30, 0]);
  assert.equal(GAMING_FRAME_COUNT, 12);
  assert.equal(GAMING_FRAME_TICKS, 2);
});
