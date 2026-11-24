import assert from 'node:assert/strict';
import test from 'node:test';
import { effectPreviewTiming, VisualEffectPreviewPlayer } from '../src/effectPreview.ts';
import { defaultVisualEffectSettings } from '../src/visualEffects.ts';

test('still images preview without a timer when effects are disabled', () => {
  assert.deepEqual(effectPreviewTiming(defaultVisualEffectSettings()), { frameCount: 1, delayMs: 0 });
});

test('gaming-only live preview matches the exported 24-frame 1-tick loop', () => {
  const defaults = defaultVisualEffectSettings();
  for (const gamingMode of ['global', 'diagonal'] as const) {
    assert.deepEqual(effectPreviewTiming({ ...defaults, gamingMode }), { frameCount: 24, delayMs: 50 });
  }
});

test('enchant and combined effects match 24 frames at one Minecraft tick', () => {
  const defaults = defaultVisualEffectSettings();
  assert.deepEqual(effectPreviewTiming({ ...defaults, enchant: true }), { frameCount: 24, delayMs: 50 });
  assert.deepEqual(effectPreviewTiming({ ...defaults, gamingMode: 'diagonal', enchant: true }), {
    frameCount: 24, delayMs: 50,
  });
});

test('a live canvas actually advances frames, repaints changing RGB pixels, and stops when paused', async () => {
  const frames: number[][] = [];
  const changes: Array<[number, number]> = [];
  const context = {
    drawImage: () => {},
    clearRect: () => {},
    getImageData: () => ({ width: 2, height: 1, data: new Uint8ClampedArray([
      30, 60, 120, 255, 90, 100, 110, 255,
    ]) }),
    createImageData: (width: number, height: number) => ({
      width, height, data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: (frame: { data: Uint8ClampedArray }) => frames.push([...frame.data]),
  };
  const canvas = {
    width: 2, height: 1,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const player = new VisualEffectPreviewPlayer(canvas, (index, count) => {
    if (count > 1) changes.push([index, count]);
  });
  try {
    player.setSource({ width: 2, height: 1 } as ImageBitmap, {
      ...defaultVisualEffectSettings(), gamingMode: 'diagonal',
    });
    assert.equal(player.isPlaying, true);
    await new Promise(resolve => setTimeout(resolve, 340));
    assert.ok(changes.some(([index, count]) => count === 12 && index >= 1),
      'animated preview must advance beyond frame zero');
    assert.ok(frames.length >= 7, '60fps preview should render more often than a 20fps export');
    assert.notDeepEqual(frames[0].slice(0, 3), frames[frames.length - 1].slice(0, 3),
      'the canvas must receive visually different pixel colors');
    player.pause();
    const beforePause = frames.length;
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.equal(frames.length, beforePause, 'paused preview must not keep rendering');
  } finally {
    player.clear();
  }
});
