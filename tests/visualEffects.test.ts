import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVisualEffectsToPixels, defaultVisualEffectSettings, diagonalProgress, enchantGlintIntensity, gamingHueShift,
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


test('independent enchant glint is seamless and actually moves', () => {
  const start = enchantGlintIntensity(0.37, 0.61, 0);
  const loop = enchantGlintIntensity(0.37, 0.61, 1);
  const moved = enchantGlintIntensity(0.37, 0.61, 0.25);
  assert.ok(start >= 0 && start <= 1);
  assert.ok(moved >= 0 && moved <= 1);
  assert.ok(Math.abs(start - loop) < 1e-10);
  assert.notEqual(start, moved);
});

test('enchant-only rendering preserves transparent pixels and alpha', () => {
  const pixels = new Uint8ClampedArray([
    90, 100, 110, 255,
    10, 20, 30, 0,
    120, 130, 140, 180,
    150, 160, 170, 255,
  ]);
  const transparentBefore = [...pixels.slice(4, 8)];
  const alphaBefore = [pixels[3], pixels[7], pixels[11], pixels[15]];
  applyVisualEffectsToPixels(pixels, 2, 2, 0.4, {
    gamingMode:'off', gamingDirection:'tl-br', enchant:true, enchantStrength:100,
  });
  assert.deepEqual([...pixels.slice(4, 8)], transparentBefore);
  assert.deepEqual([pixels[3], pixels[7], pixels[11], pixels[15]], alphaBefore);
  assert.ok(pixels[0] >= 90 && pixels[1] >= 100 && pixels[2] >= 110);
});

test('zero enchant strength leaves an enchant-only image untouched', () => {
  const pixels = new Uint8ClampedArray([80, 90, 100, 255]);
  const before = [...pixels];
  applyVisualEffectsToPixels(pixels, 1, 1, 0.5, {
    gamingMode:'off', gamingDirection:'tl-br', enchant:true, enchantStrength:0,
  });
  assert.deepEqual([...pixels], before);
});
