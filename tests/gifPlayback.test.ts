import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPreviewFrame, previewDelayMs, previewTicksFromMcmeta, retimedFrameTicks, retimeAnimationMcmeta, normalizeGifSpeed } from '../src/gifPlayback.ts';

const metadata = JSON.stringify({animation:{frametime:1,frames:[
  {index:0,time:1},{index:1,time:2},{index:2,time:10},
]}});

test('GIF animation preview reads the exact Minecraft tick durations and order', () => {
  assert.deepEqual(previewTicksFromMcmeta(metadata,3),[1,2,10]);
  assert.equal(previewDelayMs(2,1),100);
  assert.equal(previewDelayMs(2,0.25),400);
  assert.equal(previewDelayMs(2,2),50);
  assert.equal(previewDelayMs(2,1.5),50); // rounded to one Minecraft tick
  assert.equal(previewDelayMs(1,2),50); // never less than one tick
});

test('preview loop respects last frame and pause-at-end playback', () => {
  assert.equal(nextPreviewFrame(0,3,true),1);
  assert.equal(nextPreviewFrame(1,3,true),2);
  assert.equal(nextPreviewFrame(2,3,true),0);
  assert.equal(nextPreviewFrame(2,3,false),null);
  assert.equal(nextPreviewFrame(0,1,false),null);
  assert.equal(nextPreviewFrame(0,1,true),0);
});

test('malformed animation metadata and playback speed are rejected', () => {
  for (const input of [
    'not-json',
    JSON.stringify({animation:{frames:[{index:0,time:1}]}}),
    JSON.stringify({animation:{frames:[{index:0,time:0},{index:1,time:2},{index:2,time:1}]}}),
    JSON.stringify({animation:{frames:[{index:0,time:1},{index:1,time:1},{index:5,time:1}]}}),
    JSON.stringify({animation:{frames:[0,1,2]}}),
  ]) assert.throws(()=>previewTicksFromMcmeta(input,3));
  for (const count of [0,25,1.5]) assert.throws(()=>previewTicksFromMcmeta(metadata,count));
  for (const speed of [0,-1,0.2,2.1,Infinity,NaN]) assert.throws(()=>previewDelayMs(1,speed));
  for (const tick of [0,10001,1.2]) assert.throws(()=>previewDelayMs(tick,1));
  assert.throws(()=>nextPreviewFrame(3,3,true));
});

test('the existing GIF encoder supports canceling a stale preview before work starts',async()=>{
  const {processGif} = await import('../src/gifEditor.ts');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    processGif(new Blob(['GIF89a','test']),{
      x:0,y:0,width:1,height:1,keyEnabled:false,keyColor:'#00ff00',tolerance:45,feather:20,resolution:128
    },{first:1,last:1},undefined,controller.signal),
    {name:'AbortError'},
  );
});

test('preview matches exact frame timing encoded in the downloadable mcmeta', () => {
  for (const speed of [0.25,0.5,1,1.5,2]) {
    const out = retimeAnimationMcmeta(metadata, speed);
    const times = previewTicksFromMcmeta(out,3);
    assert.deepEqual(times,[1,2,10].map(t=>retimedFrameTicks(t,speed)));
    assert.deepEqual(times.map(t=>t*50),[1,2,10].map(t=>previewDelayMs(t,speed)));
  }
  assert.equal(normalizeGifSpeed(undefined),1);
  assert.equal(normalizeGifSpeed('2'),1);
  assert.equal(normalizeGifSpeed(2),2);
  assert.equal(normalizeGifSpeed(0.25),0.25);
  assert.equal(normalizeGifSpeed(NaN),1);
  assert.equal(previewDelayMs(200,0.25),40000); // 800 game ticks
});

test('invalid metadata, corrupted frame order or unsupported speeds cannot silently export', () => {
  assert.throws(()=>retimeAnimationMcmeta('bad',1));
  assert.throws(()=>retimeAnimationMcmeta(JSON.stringify({animation:{frames:[{index:1,time:1}]}}),1));
  assert.throws(()=>retimeAnimationMcmeta(metadata,0));
  assert.throws(()=>retimedFrameTicks(0,1));
  assert.throws(()=>retimedFrameTicks(1,3));
});
