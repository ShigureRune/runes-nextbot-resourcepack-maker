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

test('empty slot guides uploads directly to image and audio tabs', () => {
  const g=editorTabGuide(empty,false);
  assert.equal(g.imageState,'empty');
  assert.equal(g.audioState,'empty');
  assert.match(g.nextAction,/画像タブ/);
  assert.doesNotMatch(g.nextAction,/基本設定|動画タブ/);
});

test('GIF and video stay inside the image workflow', () => {
  const pending=editorTabGuide({...empty,visual:gif},false);
  assert.equal(pending.imageState,'pending');
  assert.match(pending.nextAction,/画像タブ/);
  const noFrame=editorTabGuide({...empty,visual:video},false);
  assert.equal(noFrame.needsVideoCapture,true);
  assert.match(noFrame.nextAction,/画像タブの動画プレビュー/);
  assert.doesNotMatch(noFrame.nextAction,/動画タブ/);
  const afterFrame=editorTabGuide({...empty,visual:video},true);
  assert.equal(afterFrame.needsVideoCapture,false);
  assert.match(afterFrame.nextAction,/画像タブ/);
});

test('processed media and audio update completion guidance', () => {
  const imageReady=editorTabGuide({...empty,visual},false);
  assert.equal(imageReady.imageState,'ready');
  assert.match(imageReady.nextAction,/音声タブ/);
  const done=editorTabGuide({...empty,visual,audio},false);
  assert.equal(done.audioState,'ready');
  assert.match(done.nextAction,/素材が揃った/);
  const pendingAudio=editorTabGuide({...empty,visual,audio:{...audio,processed:null}},false);
  assert.equal(pendingAudio.audioState,'pending');
  assert.match(pendingAudio.nextAction,/OGG/);
});

test('editor exposes only image and audio tabs while name remains separate', () => {
  const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
  const editor=source.slice(source.indexOf('<section class="panel editor-workspace"'),source.indexOf('<section class="panel"><h2>99枠の集計'));
  for(const key of ['image','audio']){
    assert.ok(editor.includes('id="editor-btn-'+key+'" aria-controls="editor-tab-'+key+'"'));
    assert.ok(editor.includes('id="editor-tab-'+key+'"'));
  }
  assert.ok(!editor.includes('id="editor-btn-basic"'));
  assert.ok(!editor.includes('id="editor-btn-video"'));
  assert.ok(editor.includes('class="name-settings"'));
  for(const id of ['slot','bot-name','image','image-video','sound','sound-video','video-to-audio','use-image-video','source-canvas','gif-live-canvas','audio-waveform','video-preview','clear-slot','save-state','feedback']){
    assert.equal(editor.split('id="'+id+'"').length-1,1,'missing or duplicated '+id);
  }
  const imageTab=editor.slice(editor.indexOf('id="editor-tab-image"'),editor.indexOf('id="editor-tab-audio"'));
  assert.ok(imageTab.includes('id="image"'));
  assert.ok(imageTab.includes('id="image-video"'));
  assert.match(imageTab, /id="image"[^>]*accept="image\/\*"/);
  assert.ok(imageTab.includes('id="video-editor"'));
  assert.ok(imageTab.includes('id="capture-video-animation"'));
  assert.ok(imageTab.includes('id="video-animation-start"'));
  assert.ok(imageTab.includes('id="video-animation-end"'));
  assert.ok(imageTab.includes('id="animation-live-panel"'));
  assert.ok(imageTab.includes('id="image-editor"'));
  const audioTab=editor.slice(editor.indexOf('id="editor-tab-audio"'));
  assert.ok(audioTab.includes('id="sound"'));
  assert.ok(audioTab.includes('id="sound-video"'));
  assert.ok(audioTab.includes('id="use-image-video"'));
  assert.ok(audioTab.includes('id="audio-editor"'));
  assert.ok(source.includes("const editorTabs = ['image', 'audio'] as const"));
  assert.ok(source.includes("activateEditorTab('image', true)"));
  assert.ok(source.includes("activateEditorTab('audio', true)"));
});

test('fixed iPhone scrollbar clipping is unchanged by editor UI overhaul',()=>{
  const css=readFileSync(new URL('../src/inventory.css',import.meta.url),'utf8');
  assert.ok(css.includes('clip-path:inset(0);contain:paint'));
  assert.ok(css.includes('.nb-scroll-rail{position:absolute;top:0;right:0;bottom:0'));
});
