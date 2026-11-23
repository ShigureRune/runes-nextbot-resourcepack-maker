import test from 'node:test';
import assert from 'node:assert/strict';
import { chromaKey, cropBounds, defaultImageSettings } from '../src/imageEditor.ts';

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
