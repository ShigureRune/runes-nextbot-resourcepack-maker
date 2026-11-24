import test from 'node:test';
import assert from 'node:assert/strict';
import { chromaKey, cropBounds, defaultImageSettings, imageFit } from '../src/imageEditor.ts';

test('crop stays inside original PNG bounds', () => {
  assert.deepEqual(cropBounds({ ...defaultImageSettings(100, 80), x: 90, y: 70, width: 50, height: 50 }, 100, 80),
    { x: 90, y: 70, width: 10, height: 10 });
});
test('chroma removes selected color but preserves unrelated pixels', () => {
  const pixels = new Uint8ClampedArray([0,255,0,255, 255,0,0,255]);
  chromaKey(pixels, '#00ff00', 20, 0);
  assert.equal(pixels[3], 0);
  assert.equal(pixels[7], 255);
});
test('chroma feather creates intermediate alpha', () => {
  const pixels = new Uint8ClampedArray([25,255,0,200]);
  chromaKey(pixels, '#00ff00', 10, 30);
  assert.ok(pixels[3] > 0 && pixels[3] < 200);
});

test('small pixel art enlarges without interpolation', () => {
  assert.deepEqual(imageFit(16, 16, 256), { x: 0, y: 0, width: 256, height: 256, smoothing: false });
});
test('large photos shrink with smoothing and retain aspect ratio', () => {
  assert.deepEqual(imageFit(4032, 3024, 256), { x: 0, y: 32, width: 256, height: 192, smoothing: true });
});
test('non-square pixel art uses transparent padding and integer boundaries', () => {
  assert.deepEqual(imageFit(32, 16, 256), { x: 0, y: 64, width: 256, height: 128, smoothing: false });
  assert.deepEqual(imageFit(1, 4096, 256), { x: 127, y: 0, width: 1, height: 256, smoothing: true });
});
test('native-size textures are not interpolated and 128px remains supported', () => {
  assert.deepEqual(imageFit(256, 256, 256), { x: 0, y: 0, width: 256, height: 256, smoothing: false });
  assert.deepEqual(imageFit(256, 256, 128), { x: 0, y: 0, width: 128, height: 128, smoothing: true });
});
