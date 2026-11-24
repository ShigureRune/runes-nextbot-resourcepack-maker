import assert from 'node:assert/strict';
import test from 'node:test';
import { spritePosition } from '../src/inventoryAnimation.ts';

test('inventory animation walks exact Minecraft tick durations and loops cleanly', () => {
  assert.deepEqual(spritePosition([1, 2, 1], 1, 0), { index: 0, next: 1, blend: 0 });
  assert.deepEqual(spritePosition([1, 2, 1], 1, 25), { index: 0, next: 1, blend: 0.5 });
  assert.deepEqual(spritePosition([1, 2, 1], 1, 50), { index: 1, next: 2, blend: 0 });
  assert.deepEqual(spritePosition([1, 2, 1], 1, 100), { index: 1, next: 2, blend: 0.5 });
  assert.deepEqual(spritePosition([1, 2, 1], 1, 150), { index: 2, next: 0, blend: 0 });
  assert.deepEqual(spritePosition([1, 2, 1], 1, 200), { index: 0, next: 1, blend: 0 });
});

test('slot animation speed is retimed in whole game ticks before preview blending', () => {
  assert.deepEqual(spritePosition([2, 2], 2, 25), { index: 0, next: 1, blend: 0.5 });
  assert.deepEqual(spritePosition([2, 2], 0.5, 100), { index: 0, next: 1, blend: 0.5 });
});

test('animation progress wraps negative and out-of-range times safely', () => {
  assert.deepEqual(spritePosition([1, 1], 1, -25), { index: 1, next: 0, blend: 0.5 });
  assert.deepEqual(spritePosition([1, 1], 1, Infinity), { index: 0, next: 1, blend: 0 });
  assert.throws(() => spritePosition([], 1, 0), RangeError);
  assert.throws(() => spritePosition([0], 1, 0), RangeError);
  assert.throws(() => spritePosition([1], 3, 0), RangeError);
});
