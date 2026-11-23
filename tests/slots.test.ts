import test from 'node:test';
import assert from 'node:assert/strict';
import { NextbotSlotStore, SLOT_COUNT, slotStatus } from '../src/slots.ts';
import { isOggVorbis, isPng } from '../src/assetValidation.ts';

const pixels = new Blob(['texture data'], { type: 'image/png' });
const audio = new Blob(['OGG Vorbis data'], { type: 'audio/ogg' });
const picture = { sourceName: 'face.png', sourceFormat: 'png' as const, source: pixels, processed: { png: pixels } };
const sound = { sourceName: 'sound.ogg', sourceFormat: 'ogg' as const, source: audio, processed: { ogg: audio } };

test('creates 99 independent empty slots with fixed IDs', () => {
  const store = new NextbotSlotStore();
  assert.equal(store.list().length, SLOT_COUNT);
  assert.equal(store.list()[0].id, 1);
  assert.equal(store.list()[98].id, 99);
  assert.equal(store.summary().empty, 99);
  assert.equal(store.summary().canExport, false);
  for (const badId of [0, 100, -1, 1.5, NaN]) {
    assert.throws(() => store.get(badId), RangeError);
    assert.throws(() => store.update(badId, { name: 'invalid' }), RangeError);
  }
});

test('different slots do not share image, audio or name', () => {
  const store = new NextbotSlotStore();
  store.update(1, { name: 'Alpha', visual: picture });
  store.update(99, { name: 'Omega', audio: sound });
  assert.equal(store.get(1).name, 'Alpha');
  assert.equal(store.get(1).audio, null);
  assert.equal(store.get(99).name, 'Omega');
  assert.equal(store.get(99).visual, null);
  assert.equal(store.get(2).name, '');
  const snapshot = store.get(1) as { name: string };
  snapshot.name = 'tampered';
  assert.equal(store.get(1).name, 'Alpha');
});

test('status only becomes complete when both processed assets exist', () => {
  const store = new NextbotSlotStore();
  store.update(1, { name: 'name alone' });
  assert.equal(slotStatus(store.get(1)), 'empty');
  store.update(1, { visual: picture });
  assert.equal(slotStatus(store.get(1)), 'partial');
  store.update(1, { audio: { ...sound, processed: null } });
  assert.equal(slotStatus(store.get(1)), 'partial');
  store.update(1, { audio: sound });
  assert.equal(slotStatus(store.get(1)), 'complete');
  store.update(1, { visual: null });
  assert.equal(slotStatus(store.get(1)), 'partial');
  store.clear(1);
  assert.equal(slotStatus(store.get(1)), 'empty');
});

test('global export gate blocks any incomplete slot and ignores empty ones', () => {
  const store = new NextbotSlotStore();
  store.update(1, { visual: picture, audio: sound });
  store.update(98, { visual: picture });
  const blocked = store.summary();
  assert.deepEqual(blocked.completeIds, [1]);
  assert.deepEqual(blocked.partialIds, [98]);
  assert.equal(blocked.empty, 97);
  assert.equal(blocked.canExport, false);
  store.clear(98);
  assert.equal(store.summary().canExport, true);
  store.update(99, { visual: picture, audio: sound });
  assert.deepEqual(store.summary().completeIds, [1, 99]);
  assert.equal(store.summary().canExport, true);
});

test('checks PNG headers and OGG Vorbis identification packets', async () => {
  const pngHeader = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,1,0,0,0,1,0]);
  const oggHeader = new Uint8Array(48);
  oggHeader.set([79,103,103,83], 0);
  oggHeader.set([1,118,111,114,98,105,115], 29);
  assert.equal(await isPng(new Blob([pngHeader])), true);
  assert.equal(await isPng(new Blob(['not a png file despite .png extension'])), false);
  assert.equal(await isOggVorbis(new Blob([oggHeader])), true);
  assert.equal(await isOggVorbis(new Blob(['fake ogg data'])), false);
});
