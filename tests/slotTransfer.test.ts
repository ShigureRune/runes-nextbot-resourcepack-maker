import test from 'node:test';
import assert from 'node:assert/strict';
import { NextbotSlotStore, slotHasContent, slotStatus } from '../src/slots.ts';

const face = new Blob(['face image'], {type:'image/png'});
const firstFrame = new Blob(['preview'], {type:'image/png'});
const originalGif = new Blob(['gif animation'], {type:'image/gif'});
const ogg = new Blob(['sound'], {type:'audio/ogg'});
const pic = {sourceName:'face.gif',sourceFormat:'gif' as const,source:originalGif,
  processed:{png:face,previewPng:firstFrame,animationMcmeta:'{"animation":{"frametime":2}}'}};
const sound = {sourceName:'sound.ogg',sourceFormat:'ogg' as const,source:ogg,processed:{ogg}};

test('copy duplicates all metadata and processed blobs while keeping source intact', () => {
  const store = new NextbotSlotStore();
  store.update(1, {name:'Alpha',visual:pic,audio:sound});
  store.transfer(1, 99, 'copy');
  assert.equal(store.get(1).name, 'Alpha');
  assert.equal(store.get(99).name, 'Alpha');
  assert.equal(store.get(99).id,99);
  assert.equal(store.get(99).visual?.processed?.animationMcmeta, pic.processed.animationMcmeta);
  assert.equal(store.get(99).visual?.processed?.png, face);
  assert.equal(store.get(99).visual?.processed?.previewPng, firstFrame);
  assert.equal(store.get(99).audio?.processed?.ogg, ogg);
  store.update(1, {name:'Renamed',visual:null});
  assert.equal(store.get(99).name, 'Alpha');
  assert.equal(store.get(99).visual?.processed?.png, face);
  assert.equal(store.summary().complete, 1);
});

test('move relocates a source to an empty target and clears source', () => {
  const store = new NextbotSlotStore();
  store.update(5,{name:'Move me',visual:pic,audio:sound});
  store.transfer(5,75,'move');
  assert.deepEqual(store.get(5), {id:5,name:'',visual:null,audio:null});
  assert.equal(store.get(75).name,'Move me');
  assert.equal(slotStatus(store.get(75)),'complete');
});

test('occupied copy and move targets require explicit overwrite authorization', () => {
  for (const mode of ['copy','move'] as const) {
    const store = new NextbotSlotStore();
    store.update(1,{name:'source',visual:pic});
    store.update(2,{name:'target',audio:sound});
    assert.throws(()=>store.transfer(1,2,mode),/上書き確認/);
    assert.equal(store.get(1).name,'source');
    assert.equal(store.get(2).name,'target');
    store.transfer(1,2,mode,true);
    assert.equal(store.get(2).name,'source');
    assert.equal(store.get(2).audio,null);
    assert.equal(store.get(1).name,mode==='copy'?'source':'');
  }
});

test('swap exchanges payloads without losing data or swapping fixed IDs', () => {
  const store = new NextbotSlotStore();
  store.update(1,{name:'first',visual:pic});
  store.update(2,{name:'second',audio:sound});
  store.transfer(1,2,'swap');
  assert.equal(store.get(1).id,1);
  assert.equal(store.get(2).id,2);
  assert.equal(store.get(1).name,'second');
  assert.equal(store.get(1).audio?.processed?.ogg,ogg);
  assert.equal(store.get(2).name,'first');
  assert.equal(store.get(2).visual?.processed?.png,face);
  store.transfer(2,99,'swap');
  assert.equal(store.get(2).name,'');
  assert.equal(store.get(99).name,'first');
});

test('name-only slots are transferable; truly blank sources and invalid operations are rejected', () => {
  const store = new NextbotSlotStore();
  store.update(1,{name:'just a name'});
  assert.equal(slotHasContent(store.get(1)),true);
  assert.equal(slotStatus(store.get(1)),'empty');
  store.transfer(1,90,'copy');
  assert.equal(store.get(90).name,'just a name');
  assert.equal(slotHasContent(store.get(50)),false);
  for (const [from,to,mode] of [[1,1,'copy'],[0,2,'copy'],[1,100,'move'],[50,60,'swap'],[1,2,'invalid']] as const) {
    assert.throws(()=>store.transfer(from,to,mode as 'copy'));
  }
  assert.equal(store.get(1).name,'just a name');
  assert.equal(store.get(90).name,'just a name');
  assert.equal(store.summary().canExport,false);
});
