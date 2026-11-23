import assert from 'node:assert/strict';
import test from 'node:test';
import { scrollGeometry } from '../src/scrollBounds.ts';

test('iOS rubber-band overscroll cannot push the thumb above or below the track', () => {
  const upper = scrollGeometry(1100, 350, -600);
  assert.deepEqual({ top: upper.topPercent, scroll: upper.clampedScrollTop }, { top: 0, scroll: 0 });
  const bottom = scrollGeometry(1100, 350, 99999);
  assert.equal(bottom.clampedScrollTop, 750);
  assert.equal(bottom.topPercent + bottom.heightPercent, 100);
});

test('normal scrolling is monotonic and leaves the thumb inside the rail', () => {
  const first = scrollGeometry(1100, 350, 0);
  const mid = scrollGeometry(1100, 350, 375);
  const last = scrollGeometry(1100, 350, 750);
  assert.equal(first.topPercent, 0);
  assert.ok(mid.topPercent > first.topPercent);
  assert.ok(mid.topPercent < last.topPercent);
  for (const pos of [-1000, -3, 0, 1, 375, 750, 2000, Infinity]) {
    const result = scrollGeometry(1100, 350, pos);
    assert.ok(result.topPercent >= 0);
    assert.ok(result.topPercent + result.heightPercent <= 100.00001);
  }
});

test('no scroll, hidden layouts and tiny viewports remain within bounds', () => {
  assert.deepEqual(scrollGeometry(100, 200, -100), { heightPercent: 100, topPercent: 0, clampedScrollTop: 0 });
  assert.deepEqual(scrollGeometry(0, 0, 0), { heightPercent: 100, topPercent: 0, clampedScrollTop: 0 });
  assert.deepEqual(scrollGeometry(NaN, 200, 0), { heightPercent: 100, topPercent: 0, clampedScrollTop: 0 });
  const tiny = scrollGeometry(1000000, 10, 999999);
  assert.equal(tiny.heightPercent, 8);
  assert.ok(tiny.topPercent >= 0 && tiny.topPercent <= 92);
});
