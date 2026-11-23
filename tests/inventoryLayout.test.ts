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

test('inventory viewport and scrollbar share a definite grid row', () => {
  const frame = rule('.nb-frame');
  assert.match(frame, /grid-template-rows:minmax\(0,1fr\)/);
  assert.match(frame, /height:min\(355px,56vw\)/);
  assert.match(frame, /overflow:hidden/);
  const area = rule('.nb-scroll-area');
  assert.match(area, /height:100%/);
  assert.match(area, /min-height:0/);
  assert.match(area, /max-height:none/);
  assert.match(area, /aspect-ratio:auto/);
  assert.match(area, /overflow-y:auto/);
  const rail = rule('.nb-scroll-rail');
  assert.match(rail, /height:100%/);
  assert.match(rail, /overflow:hidden/);
});
