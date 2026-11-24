import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVisualEffectsToPixels, defaultVisualEffectSettings, diagonalProgress, enchantGlintIntensity, GAMING_OVERLAY_OPACITY,
  hasAnimatedVisualEffects, normalizeVisualEffects, GAMING_FRAME_COUNT, GAMING_FRAME_TICKS,
} from '../src/visualEffects.ts';

test('global gaming composites a uniform semi-transparent red overlay instead of recoloring each source hue', () => {
  const pixels = new Uint8ClampedArray([
    40, 80, 120, 200,  200, 40, 70, 255,  33, 60, 90, 0,
  ]);
  applyVisualEffectsToPixels(pixels, 3, 1, 0, {
    ...defaultVisualEffectSettings(), gamingMode: 'global',
  });
  assert.equal(GAMING_OVERLAY_OPACITY, 0.45);
  assert.deepEqual([...pixels], [
    137, 44, 66, 200,  225, 22, 39, 255,  33, 60, 90, 0,
  ]);
  assert.equal(GAMING_FRAME_COUNT, 24);
  assert.equal(GAMING_FRAME_TICKS, 1);
});

test('global gaming uses exactly one tint at every position, including white and black images', () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255,  0, 0, 0, 255,
    0, 0, 0, 255,  0, 0, 0, 255,
  ]);
  const results: number[][] = [];
  for (const phase of [0, 1 / 3, 2 / 3, 1]) {
    const data = new Uint8ClampedArray(pixels);
    applyVisualEffectsToPixels(data, 2, 2, phase, {
      ...defaultVisualEffectSettings(), gamingMode: 'global',
    });
    for (let i = 4; i < data.length; i += 4) {
      assert.deepEqual([...data.slice(i, i + 4)], [...data.slice(0, 4)]);
    }
    results.push([...data.slice(0, 3)]);
  }
  assert.ok(results[0][0] > results[0][1] && results[0][0] > results[0][2]);
  assert.ok(results[1][1] > results[1][0] && results[1][1] > results[1][2]);
  assert.ok(results[2][2] > results[2][0] && results[2][2] > results[2][1]);
  assert.deepEqual(results[0], results[3]);
});

test('diagonal gaming changes the overlay hue across the image and reverses flow direction', () => {
  const source = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 3; i < source.length; i += 4) source[i] = 255;
  const render = (direction: 'tl-br' | 'br-tl') => {
    const pixels = new Uint8ClampedArray(source);
    applyVisualEffectsToPixels(pixels, 4, 4, 0.25, {
      ...defaultVisualEffectSettings(), gamingMode: 'diagonal', gamingDirection: direction,
    });
    return pixels;
  };
  const normal = render('tl-br');
  const reversed = render('br-tl');
  assert.notDeepEqual([...normal.slice(0, 3)], [...normal.slice(-4, -1)]);
  assert.deepEqual([...normal.slice(0, 4)], [...reversed.slice(-4)]);
  assert.deepEqual([...normal.slice(-4)], [...reversed.slice(0, 4)]);
  assert.ok([...normal].every((n, i) => i % 4 !== 3 || n === 255));
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
  assert.notDeepEqual([...pixels.slice(0, 3)], [90, 100, 110]);
});

test('zero enchant strength leaves an enchant-only image untouched', () => {
  const pixels = new Uint8ClampedArray([80, 90, 100, 255]);
  const before = [...pixels];
  applyVisualEffectsToPixels(pixels, 1, 1, 0.5, {
    gamingMode:'off', gamingDirection:'tl-br', enchant:true, enchantStrength:0,
  });
  assert.deepEqual([...pixels], before);
});

test('subtle glint stays visible on white and black but never creates dazzling white spots', () => {
  const size = 32;
  const white = new Uint8ClampedArray(size * size * 4).fill(255);
  const black = new Uint8ClampedArray(size * size * 4);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  const settings = { ...defaultVisualEffectSettings(), enchant: true, enchantStrength: 100 };
  applyVisualEffectsToPixels(white, size, size, 0.25, settings);
  applyVisualEffectsToPixels(black, size, size, 0.25, settings);
  let whiteGlint = 0, darkGlint = 0;
  for (let i = 0; i < white.length; i += 4) {
    if (white[i + 2] - white[i + 1] >= 12) whiteGlint++;
    if (black[i + 2] >= 25 && black[i + 2] - black[i + 1] >= 10) darkGlint++;
    // Enchant glint must preserve whites rather than paint them saturated purple.
    assert.ok(white[i] >= 205 && white[i + 1] >= 205 && white[i + 2] >= 205);
    // No incandescent bright streaks on a black image, even at 100% strength.
    assert.ok(black[i] <= 90 && black[i + 1] <= 90 && black[i + 2] <= 90);
    assert.equal(white[i + 3], 255);
    assert.equal(black[i + 3], 255);
  }
  assert.ok(whiteGlint > size * size * 0.08);
  assert.ok(darkGlint > size * size * 0.08);
});

test('default subtle 35% strength leaves most of the original pixels unchanged', () => {
  const size = 32;
  const image = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < image.length; i += 4) {
    image[i] = 120; image[i + 1] = 110; image[i + 2] = 100; image[i + 3] = 255;
  }
  const before = new Uint8ClampedArray(image);
  applyVisualEffectsToPixels(image, size, size, 0.4, {
    ...defaultVisualEffectSettings(), enchant: true,
  });
  let totalDrift = 0;
  for (let i = 0; i < image.length; i += 4) {
    totalDrift += Math.abs(image[i] - before[i]);
    totalDrift += Math.abs(image[i + 1] - before[i + 1]);
    totalDrift += Math.abs(image[i + 2] - before[i + 2]);
  }
  const meanRgbDrift = totalDrift / (size * size * 3);
  assert.ok(meanRgbDrift < 12, `RGB drift should be gentle, got ${meanRgbDrift}`);
  assert.ok(meanRgbDrift > 1, 'effect must remain visibly present');
});
test('stronger settings increase violet contrast on white textures', () => {
  const size = 16;
  const weak = new Uint8ClampedArray(size * size * 4).fill(255);
  const strong = new Uint8ClampedArray(weak);
  const settings = { ...defaultVisualEffectSettings(), enchant: true };
  assert.equal(settings.enchantStrength, 35);
  applyVisualEffectsToPixels(weak, size, size, 0.5, { ...settings, enchantStrength: 25 });
  applyVisualEffectsToPixels(strong, size, size, 0.5, { ...settings, enchantStrength: 100 });
  const contrast = (pixels: Uint8ClampedArray) => {
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += pixels[i + 2] - pixels[i + 1];
    return sum;
  };
  assert.ok(contrast(strong) > contrast(weak) * 2);
});

test('glint movement stays continuous across the loop seam', () => {
  for (const [x, y] of [[0.37, 0.61], [0.13, 0.22], [0.81, 0.46]]) {
    assert.ok(Math.abs(enchantGlintIntensity(x, y, 0.99999) -
      enchantGlintIntensity(x, y, 0)) < 0.01);
  }
});

test('glossy reflection stays uniform along the diagonal instead of making a grid', () => {
  for (const phase of [0, 0.25, 0.5, 0.75]) {
    assert.ok(Math.abs(enchantGlintIntensity(0.2, 0.8, phase) -
      enchantGlintIntensity(0.6, 0.2, phase)) < 1e-10);
  }
});
test('glint uses a soft diagonal violet band without additive white specular peaks', () => {
  const size = 32;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 80; pixels[i + 1] = 80; pixels[i + 2] = 80; pixels[i + 3] = 255;
  }
  applyVisualEffectsToPixels(pixels, size, size, 0.25, {
    ...defaultVisualEffectSettings(), enchant: true, enchantStrength: 100,
  });
  let violet = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 2] - pixels[i + 1] >= 14) violet++;
    // With a dark base texture there should never be a blown-out white core.
    assert.ok(Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) <= 135);
  }
  assert.ok(violet > size * size * 0.08);
});
