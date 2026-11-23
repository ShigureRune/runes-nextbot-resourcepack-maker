import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Regression guard for the iOS Safari layout bug: the thumb math may be
// clamped correctly while the entire scrollbar rail grows taller than
// the visible inventory due to an unconstrained CSS grid track.
const css = readFileSync(new URL('../src/inventory.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(escaped + '\\{([^}]*)\\}'));
  assert.ok(match, 'Missing CSS rule: ' + selector);
  return match[1];
}

test('scrollbar is pinned inside a clipped, paint-contained frame', () => {
  const frame = rule('.nb-frame');
  assert.match(frame, /position:relative/);
  assert.match(frame, /display:block/);
  assert.match(frame, /height:min\(355px,56vw\)/);
  assert.match(frame, /overflow:hidden/);
  assert.match(frame, /clip-path:inset\(0\)/);
  assert.match(frame, /contain:paint/);
  const area = rule('.nb-scroll-area');
  assert.match(area, /width:calc\(100% - 25px\)/);
  assert.match(area, /height:100%/);
  assert.match(area, /overflow-y:auto/);
  assert.match(area, /min-height:0/);
  const rail = rule('.nb-scroll-rail');
  assert.match(rail, /position:absolute/);
  for (const token of ['top:0', 'right:0', 'bottom:0', 'height:auto',
                       'overflow:hidden', 'clip-path:inset(0)', 'contain:paint']) {
    assert.ok(rail.includes(token), 'Scrollbar must have ' + token);
  }
  const mobile = css.match(/@media\(max-width:430px\)\{([^\n]*)/);
  assert.ok(mobile);
  assert.match(mobile[1], /\.nb-scroll-rail\{width:10px\}/);
});
