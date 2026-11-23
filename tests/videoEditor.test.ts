import assert from 'node:assert/strict';
import test from 'node:test';
import { assertVideoInfo, frameTime, isVideoFilename, MAX_VIDEO_BYTES } from '../src/videoEditor.ts';

test('recognizes supported filenames without implying codec support', () => {
  for (const name of ['a.mp4','b.M4V','c.webm','d.mov']) assert.equal(isVideoFilename(name), true);
  for (const name of ['a.png','a.mp4.exe','file']) assert.equal(isVideoFilename(name), false);
  assert.equal(MAX_VIDEO_BYTES, 32 * 1024 * 1024);
});
test('validates duration and dimensions before decoding large frames', () => {
  assert.equal(assertVideoInfo({ width: 1080, height: 1920, duration: 10 }).width, 1080);
  for (const info of [
    {width:3840,height:2160,duration:10},
    {width:1920,height:1920,duration:10},
    {width:0,height:500,duration:10},
    {width:1280,height:720,duration:121},
    {width:1280,height:720,duration:Infinity},
  ]) assert.throws(() => assertVideoInfo(info), /動画/);
});
test('rejects invalid seeks and clamps the last frame', () => {
  assert.equal(frameTime(0, 10), 0);
  assert.equal(frameTime(5, 10), 5);
  assert.ok(frameTime(10, 10) < 10);
  for (const pos of [-1, 11, NaN, Infinity]) assert.throws(() => frameTime(pos, 10), RangeError);
});

test('video slots remain partial until an actual PNG is prepared', async () => {
  const { NextbotSlotStore, slotStatus } = await import('../src/slots.ts');
  const store = new NextbotSlotStore();
  const video = new Blob(['video bytes'], { type: 'video/mp4' });
  const visual = { sourceName: 'movie.mp4', sourceFormat: 'video' as const, source: video, processed: null };
  store.update(1, { visual });
  assert.equal(slotStatus(store.get(1)), 'partial');
  assert.equal(store.summary().canExport, false);
  store.update(1, { visual: { ...visual, processed: { png: new Blob(['png bytes']) } } });
  assert.equal(slotStatus(store.get(1)), 'partial');
  store.update(1, { audio: {
    sourceName: 'sound.ogg', sourceFormat: 'ogg', source: new Blob(['ogg']),
    processed: { ogg: new Blob(['ogg']) },
  } });
  assert.equal(slotStatus(store.get(1)), 'complete');
});
