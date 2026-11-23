import assert from 'node:assert/strict';
import test from 'node:test';
import { frameTicks, validFrameRange, inspectGif } from '../src/gifEditor.ts';

test('GIF frame range uses 1-based inclusive bounds', () => {
  assert.equal(validFrameRange({first:1,last:24},24),true);
  for (const pair of [[0,1],[2,1],[1,25],[1.5,4]]) {
    assert.equal(validFrameRange({first:pair[0],last:pair[1]},24),false);
  }
});
test('GIF delays map to positive Minecraft ticks', () => {
  assert.equal(frameTicks(50),1);
  assert.equal(frameTicks(100),2);
  assert.equal(frameTicks(500),10);
  assert.equal(frameTicks(0),2);
});
test('GIF header and dimensions are parsed without rendering', async () => {
  const gif = new Blob([Buffer.from('R0lGODdhAQABAIEAAP8AAAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==', 'base64')]);
  const info = await inspectGif(gif);
  assert.equal(info.width, 1);
  assert.equal(info.height, 1);
  await assert.rejects(inspectGif(new Blob(['not a gif'])),/GIF/);
});
