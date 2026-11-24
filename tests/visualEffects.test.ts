import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVisualEffectsToPixels, defaultVisualEffectSettings, diagonalProgress, gamingHueShift,
  hasAnimatedVisualEffects, normalizeVisualEffects, GAMING_FRAME_COUNT, GAMING_FRAME_TICKS,
} from '../src/visualEffects.ts';

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


test('diagonal gaming supports all four selected flow directions', () => {
  assert.equal(diagonalProgress(0, 0, 10, 10, 'tl-br'), 0);
  assert.equal(diagonalProgress(9, 9, 10, 10, 'tl-br'), 1);
  assert.equal(diagonalProgress(9, 0, 10, 10, 'tr-bl'), 0);
  assert.equal(diagonalProgress(0, 9, 10, 10, 'tr-bl'), 1);
  assert.equal(diagonalProgress(0, 9, 10, 10, 'bl-tr'), 0);
  assert.equal(diagonalProgress(9, 0, 10, 10, 'bl-tr'), 1);
  assert.equal(diagonalProgress(9, 9, 10, 10, 'br-tl'), 0);
  assert.equal(diagonalProgress(0, 0, 10, 10, 'br-tl'), 1);
});

test('visual effect settings migrate the old gaming flag and bound enchant strength', () => {
  assert.equal(normalizeVisualEffects(undefined, true).gamingMode, 'global');
  assert.equal(normalizeVisualEffects({gamingMode:'diagonal',gamingDirection:'br-tl',enchant:true,enchantStrength:999}).enchantStrength, 100);
  assert.equal(normalizeVisualEffects({gamingMode:'bad',enchantStrength:-5}).gamingMode, 'off');
  assert.equal(normalizeVisualEffects({gamingMode:'off',enchantStrength:-5}).enchantStrength, 0);
  assert.equal(hasAnimatedVisualEffects(defaultVisualEffectSettings()), false);
  assert.equal(hasAnimatedVisualEffects({...defaultVisualEffectSettings(), enchant:true}), true);
});

test('diagonal gaming and enchant glint both modify pixels without changing alpha', () => {
  const pixels = new Uint8ClampedArray([
    120,120,120,255, 120,120,120,255,
    120,120,120,255, 120,120,120,255,
  ]);
  const before = [...pixels];
  applyVisualEffectsToPixels(pixels, 2, 2, 0.25, {
    gamingMode:'diagonal', gamingDirection:'tl-br', enchant:true, enchantStrength:80,
  });
  assert.notDeepEqual([...pixels], before);
  assert.deepEqual([pixels[3],pixels[7],pixels[11],pixels[15]],[255,255,255,255]);
  assert.notDeepEqual([...pixels.slice(0,3)], [...pixels.slice(12,15)]);
});
