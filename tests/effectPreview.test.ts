import assert from 'node:assert/strict';
import test from 'node:test';
import { effectPreviewTiming } from '../src/effectPreview.ts';
import { defaultVisualEffectSettings } from '../src/visualEffects.ts';

test('still images preview without a timer when effects are disabled', () => {
  assert.deepEqual(effectPreviewTiming(defaultVisualEffectSettings()), { frameCount: 1, delayMs: 0 });
});

test('gaming-only live preview matches the exported twelve-frame 2-tick loop', () => {
  const defaults = defaultVisualEffectSettings();
  for (const gamingMode of ['global', 'diagonal'] as const) {
    assert.deepEqual(effectPreviewTiming({ ...defaults, gamingMode }), { frameCount: 12, delayMs: 100 });
  }
});

test('enchant and combined effects match 24 frames at one Minecraft tick', () => {
  const defaults = defaultVisualEffectSettings();
  assert.deepEqual(effectPreviewTiming({ ...defaults, enchant: true }), { frameCount: 24, delayMs: 50 });
  assert.deepEqual(effectPreviewTiming({ ...defaults, gamingMode: 'diagonal', enchant: true }), {
    frameCount: 24, delayMs: 50,
  });
});
