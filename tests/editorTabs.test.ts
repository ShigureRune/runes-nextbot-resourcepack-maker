import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorTabGuide } from '../src/editorTabs.ts';
import type { NextbotSlot } from '../src/slots.ts';

const empty: NextbotSlot = {id:1,name:'',visual:null,audio:null};
const png = new Blob(['face'],{type:'image/png'});
const ogg = new Blob(['audio'],{type:'audio/ogg'});
const visual = {sourceName:'a.png',sourceFormat:'png' as const,source:png,processed:{png}};
const gif = {sourceName:'a.gif',sourceFormat:'gif' as const,source:png,processed:null};
const video = {sourceName:'a.mp4',sourceFormat:'video' as const,source:png,processed:null};
const audio = {sourceName:'b.ogg',sourceFormat:'ogg' as const,source:ogg,processed:{ogg}};

test('empty slot gives clear upload guidance on every edit tab', () => {
  const g=editorTabGuide(empty,false);
  assert.equal(g.imageEmpty,true);
  assert.equal(g.videoEmpty,true);
  assert.equal(g.audioEmpty,true);
  assert.equal(g.imageState,'empty');
  assert.match(g.nextAction,/基本設定/);
});

test('GIF and video previews guide the user to the next required editing step', () => {
  const pending=editorTabGuide({...empty,visual:gif},false);
  assert.equal(pending.imageEmpty,false);
  assert.match(pending.nextAction,/画像・GIF/);
  const noFrame=editorTabGuide({...empty,visual:video},false);
  assert.equal(noFrame.imageEmpty,true);
  assert.equal(noFrame.videoEmpty,false);
  assert.equal(noFrame.needsVideoCapture,true);
  assert.match(noFrame.nextAction,/動画タブ/);
  const afterFrame=editorTabGuide({...empty,visual:video},true);
  assert.equal(afterFrame.imageEmpty,false);
  assert.equal(afterFrame.needsVideoCapture,false);
  assert.match(afterFrame.nextAction,/画像・GIF/);
});

test('processed media and audio update status and completion guidance', () => {
  const imageReady=editorTabGuide({...empty,visual},false);
  assert.equal(imageReady.imageState,'ready');
  assert.match(imageReady.nextAction,/音声/);
  const done=editorTabGuide({...empty,visual,audio},false);
  assert.equal(done.imageEmpty,false);
  assert.equal(done.audioEmpty,false);
  assert.equal(done.audioState,'ready');
  assert.match(done.nextAction,/素材が揃った/);
  const pendingAudio=editorTabGuide({...empty,visual,audio:{...audio,processed:null}},false);
  assert.equal(pendingAudio.audioState,'pending');
  assert.match(pendingAudio.nextAction,/OGG/);
});

test('each accessible tab wraps one original editor and preserves existing IDs', () => {
  const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
  const editor=source.slice(source.indexOf('<section class="panel editor-workspace"'),source.indexOf('<section class="panel"><h2>99枠の集計'));
  for(const [key,id] of [['basic','slot'],['image','image-editor'],['video','video-editor'],['audio','audio-editor']]){
    assert.ok(editor.includes('id="editor-btn-'+key+'" aria-controls="editor-tab-'+key+'"'));
    assert.ok(editor.includes('id="editor-tab-'+key+'"'));
    assert.equal(editor.split('id="'+id+'"').length-1,1,'missing or duplicated '+id);
  }
  for(const id of ['back-list','prev-slot','next-slot','bot-name','image','sound','source-canvas','gif-live-canvas','audio-waveform','video-preview','clear-slot','save-state','feedback']){
    assert.equal(editor.split('id="'+id+'"').length-1,1,'missing or duplicated '+id);
  }
  assert.ok(source.includes("activateEditorTab('image', true)"));
  assert.ok(source.includes("activateEditorTab('audio', true)"));
  assert.ok(source.includes('role="tabpanel"'));
  assert.ok(source.includes('role="tablist"'));
});

test('fixed iPhone scrollbar clipping is unchanged by editor UI overhaul',()=>{
  const css=readFileSync(new URL('../src/inventory.css',import.meta.url),'utf8');
  assert.ok(css.includes('clip-path:inset(0);contain:paint'));
  assert.ok(css.includes('.nb-scroll-rail{position:absolute;top:0;right:0;bottom:0'));
});
