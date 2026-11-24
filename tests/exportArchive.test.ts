import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { buildAssetArchive } from '../src/exportArchive.ts';
import type { NextbotSlot } from '../src/slots.ts';

const png = new Uint8Array(24);
png.set([137,80,78,71,13,10,26,10], 0);
png.set([73,72,68,82], 12);
const ogg = new Uint8Array(44);
ogg.set([79,103,103,83], 0);
ogg.set([1,118,111,114,98,105,115], 29);
function complete(id: number): NextbotSlot {
  return { id, name: 'Test', visual: {source: new Blob([png]), sourceName: 'a.png', sourceFormat: 'png', processed: {png: new Blob([png])}},
    audio: {source: new Blob([ogg]), sourceName:'b.ogg',sourceFormat:'ogg',processed:{ogg:new Blob([ogg])}} };
}
test('asset ZIP collects complete slots only and marks itself as not MOD compatible', async () => {
  const zipBlob = await buildAssetArchive([complete(1), {id:2,name:'',visual:null,audio:null},complete(99)]);
  const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  const paths = Object.keys(zip.files);
  assert.ok(paths.includes('slots/slot_01/face.png'));
  assert.ok(paths.includes('slots/slot_99/sound.ogg'));
  assert.ok(!paths.includes('pack.mcmeta'));
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(manifest.resourcePackCompatible, false);
  assert.equal(manifest.slots.length, 2);
});
test('refuses partial slots even when a complete slot exists', async () => {
  const incomplete: NextbotSlot = {id:3,name:'',visual:complete(1).visual,audio:null};
  await assert.rejects(buildAssetArchive([complete(1), incomplete]), /設定途中/);
});
test('refuses no complete slots, duplicates and corrupted processed data', async () => {
  await assert.rejects(buildAssetArchive([{id:1,name:'hello',audio:null,visual:null}]), /完成済み/);
  await assert.rejects(buildAssetArchive([complete(1),complete(1)]), /重複/);
  const broken: NextbotSlot = {...complete(1),visual:{...complete(1).visual!,processed:{png:new Blob(['not PNG'])}}};
  await assert.rejects(buildAssetArchive([broken]), /形式検証/);
});

test('ZIP animation duration and manifest use the saved per-slot GIF speed', async () => {
  const slot = complete(3);
  const baseMeta = JSON.stringify({animation:{frametime:1,frames:[
    {index:0,time:1},{index:1,time:3},{index:2,time:5},
  ]}});
  const animated: NextbotSlot = {
    ...slot, visual: { ...slot.visual!, sourceFormat:'gif', animationSpeed:2,
      processed:{ png:slot.visual!.processed!.png, animationMcmeta:baseMeta } },
  };
  const zip = await JSZip.loadAsync(await (await buildAssetArchive([animated])).arrayBuffer());
  const mcmeta = JSON.parse(await zip.file('slots/slot_03/face.png.mcmeta')!.async('string'));
  assert.deepEqual(mcmeta.animation.frames.map((f:{time:number})=>f.time),[1,2,3]);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(manifest.slots[0].animationSpeed,2);
  assert.equal(manifest.slots[0].animation,'slots/slot_03/face.png.mcmeta');
  const original = JSON.parse(baseMeta);
  assert.deepEqual(original.animation.frames.map((f:{time:number})=>f.time),[1,3,5]);

  const slow: NextbotSlot = { ...animated, visual: {...animated.visual!, animationSpeed:0.25} };
  const slowZip = await JSZip.loadAsync(await (await buildAssetArchive([slow])).arrayBuffer());
  const slowData = JSON.parse(await slowZip.file('slots/slot_03/face.png.mcmeta')!.async('string'));
  assert.deepEqual(slowData.animation.frames.map((f:{time:number})=>f.time),[4,12,20]);
});
