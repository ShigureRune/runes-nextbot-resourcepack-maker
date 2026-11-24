import { isOggVorbis, isPng } from './assetValidation';
import { NextbotSlotStore, SLOT_COUNT, slotStatus } from './slots';
import { editorTabGuide } from './editorTabs';
import type { EditorTab } from './editorTabs';
import { mountInventory } from './inventory';
import { loadSlots, saveSlots } from './persistence';
import { cropBounds, defaultImageSettings, loadPng, processPng, sampleColor } from './imageEditor';
import type { ImageEditSettings } from './imageEditor';
import { decodeAudio, encodeVorbisRange, waveformPeaks, MAX_AUDIO_BYTES, sampleRange, normalizeDistortionAmount, decodeVideoAudio, audioBufferToWav } from './audioEditor';
import { buildAssetArchive } from './exportArchive';
import { inspectGif, processGif, validFrameRange } from './gifEditor';
import { GifPreviewPlayer, previewTicksFromMcmeta, normalizeGifSpeed } from './gifPlayback';
import {
  applyVisualEffectsFramePng, createVisualEffectAnimation, defaultVisualEffectSettings,
  hasAnimatedVisualEffects, normalizeVisualEffects,
} from './visualEffects';
import type { GamingDirection, GamingMode, VisualEffectSettings } from './visualEffects';
import { inspectVideo, captureVideoFrame, assertVideoInfo, isVideoFilename, frameTime, videoAnimationPlan, processVideoAnimation } from './videoEditor';
import type { VideoAnimationRange } from './videoEditor';
import { MOD_DOWNLOAD_JAR_URL, verifiedJarUrl, jarFilename } from './modRelease';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root missing');

app.innerHTML = `
<main>
  <header><h1>Rune's Nextbot Maker</h1><p class="subtitle">RESOURCE PACK WORKSHOP · NEXTBOT INVENTORY</p><a class="mod-shortcut" href="#mod-download">MODの入手案内 ↓</a></header>
  <section id="inventory-root" aria-label="Nextbotスロット一覧"></section>
  <p class="note inventory-help">スロットをタップすると専用編集画面が開きます。</p>

  <section class="panel editor-workspace" id="editor-panel" hidden aria-label="Nextbotスロットの編集">
    <div class="editor-nav editor-nav-v2">
      <button id="back-list" type="button" class="secondary-button">← 一覧</button>
      <strong id="editor-heading">Slot 01</strong>
      <div class="editor-stepper" aria-label="スロットを移動">
        <button id="prev-slot" type="button" class="secondary-button" aria-label="前のスロット">◀ 前へ</button>
        <button id="next-slot" type="button" class="secondary-button" aria-label="次のスロット">次へ ▶</button>
      </div>
    </div>
    <div class="editor-hero">
      <div class="preview"><img id="preview" alt="Nextbot画像のプレビュー" hidden><span id="preview-label" class="note">画像未登録</span></div>
      <div class="editor-hero-details">
        <div class="editor-hero-top">
          <h2 id="editor-shortname">名前未設定</h2>
          <p id="slot-state" class="note" role="status" aria-live="polite"></p>
        </div>
        <p id="image-name" class="note"></p>
        <p id="sound-name" class="note"></p>
        <p id="editor-next-action" class="editor-next-action">画像または音声を登録してください。</p>
      </div>
    </div>
    <div class="editor-feedback-area">
      <p id="save-state" class="note" role="status" aria-live="polite">保存データを読み込み中…</p>
      <p id="feedback" class="status" role="status" aria-live="polite"></p>
    </div>
    <section class="name-settings" aria-label="Nextbotの名前">
      <select id="slot" hidden aria-hidden="true"></select>
      <label>Nextbotの名前<input id="bot-name" maxlength="40" placeholder="例：My Nextbot"></label>
    </section>
    <nav id="editor-tab-nav" class="editor-tab-nav" role="tablist" aria-label="編集する項目">
      <button type="button" role="tab" class="editor-tab-button" id="editor-btn-image" aria-controls="editor-tab-image" aria-selected="true" tabindex="0" data-editor-tab="image">▧ 画像・動画</button>
      <button type="button" role="tab" class="editor-tab-button" id="editor-btn-audio" aria-controls="editor-tab-audio" aria-selected="false" tabindex="-1" data-editor-tab="audio">♫ 音声</button>
    </nav>
    <section id="editor-tab-image" class="editor-tab-panel" role="tabpanel" aria-labelledby="editor-btn-image" tabindex="0">
      <section class="setup-block media-upload-block" aria-label="画像・GIF・動画の登録">
        <h3>画像・GIF・動画</h3>
        <p class="note">写真ライブラリやファイルから画像を選択できます。JPEG・WebP・対応ブラウザのHEICなどはPNGに変換します。動画は画像・音声の両方に自動登録されます。</p>
        <div class="fields">
          <label>画像・GIF（写真ライブラリ対応）<input id="image" type="file" accept="image/*,.png,.gif,.jpg,.jpeg,.webp,.heic,.heif,.avif"></label>
          <label>動画（MP4 / WebM / MOV）<input id="image-video" type="file" accept=".mp4,.m4v,.webm,.mov,video/mp4,video/webm,video/quicktime"></label>
        </div>
      </section>
    <section id="video-editor" class="image-editor" hidden aria-label="動画プレビューと素材抽出">
      <h3>動画から素材を抽出</h3>
      <p class="note">動画を再生して位置を選び、フレームを取り込んだ後、下の画像編集で切り抜き・背景透過を適用できます。元の動画は保持します。</p>
      <video id="video-preview" class="video-preview" controls playsinline preload="metadata"></video>
      <label>静止画を取り出す秒数<input id="video-time" type="number" min="0" step="0.01" value="0"></label>
      <input id="video-seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="動画の再生位置">
      <div class="editor-actions"><button id="capture-video" type="button">このフレームを画像編集へ</button><button id="video-to-audio" class="secondary-button" type="button">この動画の音声を編集へ</button></div>
      <section class="setup-block" aria-label="動画のアニメーション抽出">
        <h4>動画からアニメーション</h4>
        <div class="fields">
          <label>開始（秒）<input id="video-animation-start" type="number" min="0" step="0.05" value="0"></label>
          <label>終了（秒）<input id="video-animation-end" type="number" min="0.1" step="0.05" value="1"></label>
          <label>最大フレーム数<input id="video-animation-count" type="number" min="2" max="24" step="1" value="24"></label>
        </div>
        <div class="editor-actions"><button id="video-start-here" class="secondary-button" type="button">現在位置を開始に</button><button id="video-end-here" class="secondary-button" type="button">現在位置を終了に</button></div>
        <button id="capture-video-animation" type="button" disabled>この区間をアニメーション編集へ</button>
        <p class="note">最大24フレーム。短い区間は20fps相当（50ms/tick）に合わせてフレーム数を調整。全フレームに同じ切り抜き・透過・エフェクトを適用できます。</p>
      </section>
      <p id="video-status" class="note" role="status" aria-live="polite"></p>
      <p class="note">上限32MiB・120秒・約207万画素。MP4/WebM/MOVのコーデック対応はブラウザ依存です。音声は音声タブで切り抜いてOGGにできます。</p>
    </section>
    <section id="image-editor" class="image-editor" hidden aria-label="画像・動画フレーム編集">
      <h3>画像編集（PNG / GIF / 動画フレーム）</h3><p class="note">元画像の座標で範囲指定。元画像をドラッグして切り抜き範囲を選択。クリックだけならスポイトで色を選べます。適用するまで登録画像は変更されません。</p>
      <canvas id="source-canvas" class="source-canvas" aria-label="元画像・ドラッグで切り抜き、クリックで色スポイト" tabindex="0"></canvas><p class="note">加工プレビュー（未適用）</p><canvas id="processed-preview" class="source-canvas" aria-label="加工後のプレビュー"></canvas>
      <div class="fields">
        <label>切り抜き X<input id="crop-x" type="number" min="0" step="1"></label>
        <label>切り抜き Y<input id="crop-y" type="number" min="0" step="1"></label>
        <label>幅<input id="crop-width" type="number" min="1" step="1"></label>
        <label>高さ<input id="crop-height" type="number" min="1" step="1"></label>
        <label>背景透過（クロマキー）<input id="key-enabled" type="checkbox"></label>
        <label>スポイトの色<input id="key-color" type="color" value="#00ff00"></label>
        <label>許容範囲<input id="key-tolerance" type="range" min="0" max="255" value="45"></label>
        <label>境界のぼかし<input id="key-feather" type="range" min="0" max="100" value="20"></label>
        <label>出力サイズ<select id="image-resolution"><option value="256">256×256</option><option value="128">128×128</option></select></label>
      </div>
      <section class="visual-effects-box" aria-label="動く画像エフェクト">
        <h4>✨ 動く画像エフェクト</h4>
        <div class="fields">
          <label>🌈 ゲーミング
            <select id="gaming-mode">
              <option value="off">OFF</option>
              <option value="global">全体が同時に変化</option>
              <option value="diagonal">斜めに虹が流れる</option>
            </select>
          </label>
          <label id="gaming-direction-label" hidden>斜めの向き
            <select id="gaming-direction">
              <option value="tl-br">↘ 左上 → 右下</option>
              <option value="tr-bl">↙ 右上 → 左下</option>
              <option value="bl-tr">↗ 左下 → 右上</option>
              <option value="br-tl">↖ 右下 → 左上</option>
            </select>
          </label>
          <label class="effect-toggle">✨ エンチャント風グリント（独自再現）<input id="enchant-enabled" type="checkbox"></label>
          <label id="enchant-strength-label" hidden>グリントの強さ <span id="enchant-strength-value">55%</span>
            <input id="enchant-strength" type="range" min="0" max="100" step="5" value="55">
          </label>
        </div>
        <p class="effect-note">ゲーミングとエンチャント風は重ね掛けOK。エンチャント風はゲーム本体の画像・コードを使わず、斜めに流れるグリント模様とテクスチャ変換風の動きを独自再現します。PNGや動画フレームでも、動くエフェクトを選ぶと自動で12フレームのMinecraftアニメーション素材になります。</p>
      </section>
      <div id="gif-range" hidden>
        <p class="note" id="gif-info">GIFフレームを読み込み中…</p>
        <div class="fields">
          <label>GIF開始フレーム（1から）<input id="gif-start" type="number" min="1" step="1" value="1"></label>
          <label>GIF終了フレーム（含む）<input id="gif-end" type="number" min="1" step="1" value="1"></label>
        </div>
        <p class="note">GIFの全フレームに同じ切り抜き・クロマキーを適用します。最大24フレーム。再生速度は50ms単位に変換されます。</p>
      </div>
        <section id="animation-live-panel" class="gif-live-panel" aria-label="保存前のアニメーションプレビュー" hidden>
          <h4>▶ 保存前のアニメーションプレビュー</h4>
          <canvas id="gif-live-canvas" width="256" height="256" role="img" aria-label="編集中のアニメーション"></canvas>
          <span id="gif-live-frame" class="gif-live-frame" aria-hidden="true">フレーム：―</span>
          <div class="gif-live-controls">
            <button id="gif-live-toggle" class="secondary-button" type="button" disabled>再生</button>
            <label>アニメーション速度（ゲーム用）
              <select id="gif-live-speed"><option value="0.25">0.25倍</option><option value="0.5">0.5倍</option><option value="1" selected>1倍</option><option value="1.5">1.5倍</option><option value="2">2倍</option></select>
            </label>
            <label class="gif-live-loop"><input id="gif-live-loop" type="checkbox" checked>ループ再生</label>
          </div>
          <p id="gif-live-status" class="note" role="status" aria-live="polite">アニメーションを読み込むと表示されます。</p>
          <p class="note">切り抜き・透過・フレーム範囲の変更を反映。速度はスロットに自動保存され、出力ZIPのアニメーションにも反映します。Minecraftの仕様で最短1tick（50ms）、中間の速度は丸められます。ループ切替はプレビュー専用です。</p>
        </section>
      <p class="note" id="crop-info"></p>
      <button type="button" id="apply-image">画像編集を適用</button>
      <p id="image-edit-status" class="note" role="status"></p>
    </section>
      <details class="editor-danger">
        <summary>画像素材を削除</summary>
        <p class="note">元画像・GIF・動画と加工結果をこのスロットから削除します。</p>
        <div class="editor-actions"><button id="remove-image" type="button" class="secondary-button">画像だけ削除</button></div>
      </details>
    </section>
    <section id="editor-tab-audio" class="editor-tab-panel" role="tabpanel" aria-labelledby="editor-btn-audio" tabindex="0" hidden>
      <section class="setup-block media-upload-block" aria-label="音声の登録">
        <h3>音声</h3>
        <p class="note">MP3 / OGG Vorbisをここから登録します。MP3は下の編集欄でOGGへ変換できます。</p>
        <div class="fields">
          <label>音声ファイル（MP3 / OGG）<input id="sound" type="file" accept=".mp3,.ogg,audio/mpeg,audio/ogg"></label>
          <label>動画（画像・音声に登録）<input id="sound-video" type="file" accept=".mp4,.m4v,.webm,.mov,video/mp4,video/webm,video/quicktime"></label>
        </div>
        <button id="use-image-video" type="button" class="secondary-button" hidden>画像タブの動画から音声を取り込む</button>
        <p class="note">動画はどちらのタブから選んでも画像・音声の両方に登録されます。音声は下の波形で独立して切り抜けます。動画は32MiB・120秒以内。コーデック対応はブラウザに依存します。</p>
      </section>
    <section id="audio-editor" class="image-editor" hidden aria-label="音声編集">
      <h3>音声編集（MP3 / OGG / 動画音声）</h3>
      <p class="note">音声を聴きながら開始・終了位置を指定し、「切り抜いてOGG保存」で本物のOGG Vorbisに変換します（元ファイルは保持）。音声ファイルは20MiB・120秒以内。動画は32MiBまで。</p>
      <audio id="audio-preview" controls preload="metadata" style="width:100%"></audio>
      <canvas id="audio-waveform" width="640" height="100" class="audio-waveform" aria-label="音声波形と切り抜き範囲"></canvas>
      <div class="fields">
        <label>開始位置（秒）<input id="audio-start" type="number" min="0" step="0.01" value="0"></label>
        <label>終了位置（秒）<input id="audio-end" type="number" min="0" step="0.01" value="0"></label>
        <label>🔊 音割れ強度 <span id="audio-distortion-value">0（OFF）</span><input id="audio-distortion" type="range" min="0" max="100" step="5" value="0"></label>
      </div>
      <p class="effect-note">音割れは元音声を残したまま、OGG保存時にクリッピング加工します。0でOFF、100で最大です。</p>
      <p id="audio-range-status" class="note" role="status"></p>
      <div class="editor-actions">
        <button id="play-audio-range" type="button" class="secondary-button">指定範囲を試聴</button>
        <button id="apply-audio" type="button">切り抜いてOGG保存</button>
      </div>
      <p class="note">MP3と動画音声は変換完了まで未完成扱いです。ブラウザが元音声をデコードできない場合、編集はできません。</p>
    </section>

      <details class="editor-danger">
        <summary>音声素材を削除</summary>
        <p class="note">元音声と加工結果をこのスロットから削除します。</p>
        <div class="editor-actions"><button id="remove-sound" type="button" class="secondary-button">音声だけ削除</button></div>
      </details>
    </section>
    <details class="editor-danger editor-clear-slot">
      <summary>このスロットを初期化</summary>
      <p class="note">名前・画像・音声をすべて削除します。</p>
      <div class="editor-actions"><button id="clear-slot" type="button" class="secondary-button">このスロットを空にする</button></div>
    </details>
  </section>
  <section class="panel"><h2>99枠の集計</h2>
    <p id="summary" aria-live="polite"></p>
    <p id="export-state" class="note"></p>
    <button id="download" type="button" disabled>完成枠を素材ZIPに保存（MOD未対応）</button>
    <p class="warning">素材ZIPはバックアップ・受け渡し用で、Minecraftのリソースパックではありません。MODの正確な仕様が未確認のため、ゲーム用パックの出力はまだできません。</p>
  </section>
  <section id="mod-download" class="panel mod-download-panel" aria-label="Rune's Nextbot MODの配布情報">
    <h2>Rune's Nextbot MODを入手</h2>
    <p class="note">このMakerは素材を作るWebツールです。Minecraft Java版で使うMOD本体とは別のものです。</p>
    <div class="mod-release-body">
      <p id="mod-download-status" class="mod-release-status" role="status">MODのダウンロード情報を確認中…</p>
      <a id="mod-download-link" class="mod-download-link" href="#" download hidden>MOD本体（.jar）をダウンロード ↓</a>
      <p class="note">公式のJARファイルの配布先が登録されると、ボタン1回で直接ダウンロードできます。配布元やブラウザによってはダウンロード確認が表示される場合があります。</p>
    </div>
  </section>
  <footer>Rune's Nextbot Maker · Minecraft非公式ツール</footer>
</main>`;

function get<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}

const modDownloadStatus = get<HTMLElement>('mod-download-status');
const modDownloadLink = get<HTMLAnchorElement>('mod-download-link');
const modJarUrl = verifiedJarUrl(MOD_DOWNLOAD_JAR_URL);
if (modJarUrl) {
  // A real, verified JAR link goes directly to the file, not a releases page.
  modDownloadLink.href = modJarUrl;
  modDownloadLink.download = jarFilename(modJarUrl);
  modDownloadLink.hidden = false;
  modDownloadStatus.textContent = 'MOD本体（.jar）を直接ダウンロードできます。';
} else {
  modDownloadLink.removeAttribute('href');
  modDownloadLink.removeAttribute('download');
  modDownloadLink.hidden = true;
  modDownloadStatus.textContent = 'MOD本体のJARファイルはまだ登録されていません。公式ファイルの公開後にダウンロードボタンを有効化します。';
}

const store = new NextbotSlotStore();
const saveState = get<HTMLParagraphElement>('save-state');
let ready = false;
let revision = 0;
let savedRevision = 0;
let saveQueue = Promise.resolve();

function queueSave(): void {
  if (!ready) return;
  const version = ++revision;
  const snapshot = store.list();
  saveState.textContent = '端末に保存中…';
  saveState.dataset.status = 'saving';
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    try {
      await saveSlots(snapshot);
      savedRevision = version;
      if (savedRevision === revision) { saveState.textContent = 'この端末に保存済み'; saveState.dataset.status = 'saved'; }
    } catch (error) {
      saveState.textContent = '保存失敗：空き容量やブラウザの設定を確認してください。' + (error instanceof Error ? ' ' + error.message : '');
      saveState.dataset.status = 'error';
    }
  });
}

const slotSelect = get<HTMLSelectElement>('slot');
for (let id = 1; id <= SLOT_COUNT; id++) {
  slotSelect.add(new Option(`Slot ${String(id).padStart(2, '0')}`, String(id)));
}

const nameInput = get<HTMLInputElement>('bot-name');
const imageInput = get<HTMLInputElement>('image');
const soundInput = get<HTMLInputElement>('sound');
const imageVideoInput = get<HTMLInputElement>('image-video');
const soundVideoInput = get<HTMLInputElement>('sound-video');
const useImageVideo = get<HTMLButtonElement>('use-image-video');
let audioUploadVersion = 0;
const audioEditor = get<HTMLElement>('audio-editor');
const audioPreview = get<HTMLAudioElement>('audio-preview');
const audioStart = get<HTMLInputElement>('audio-start');
const audioEnd = get<HTMLInputElement>('audio-end');
const audioRangeStatus = get<HTMLElement>('audio-range-status');
const audioWaveform = get<HTMLCanvasElement>('audio-waveform');
const audioApplyButton = get<HTMLButtonElement>('apply-audio');
const audioDistortion = get<HTMLInputElement>('audio-distortion');
const audioDistortionValue = get<HTMLSpanElement>('audio-distortion-value');
let audioPreviewUrl: string | null = null;
let audioPreviewBlob: Blob | null = null;
let audioPreviewSlot = 0;
let audioDecoded: AudioBuffer | null = null;
let audioDecodeToken = 0;
let rangePlayback = false;

function stopAudioPreview(): void {
  rangePlayback = false;
  audioPreview.pause();
}
function drawAudioWaveform(): void {
  const ctx = audioWaveform.getContext('2d');
  if (!ctx) return;
  const { width, height } = audioWaveform;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#182334'; ctx.fillRect(0, 0, width, height);
  if (!audioDecoded) return;
  const duration = audioDecoded.duration;
  const start = Math.max(0, Math.min(duration, Number(audioStart.value) || 0));
  const end = Math.max(start, Math.min(duration, Number(audioEnd.value) || duration));
  ctx.fillStyle = '#6553aa';
  ctx.fillRect(width * start / duration, 0, width * (end - start) / duration, height);
  const peaks = waveformPeaks(audioDecoded.getChannelData(0), width);
  ctx.fillStyle = '#8de8e2';
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(1, peaks[i] * height * 0.9);
    ctx.fillRect(i, (height - h) / 2, 1, h);
  }
}
function renderAudioEditor(id: number): void {
  const slot = store.get(id);
  const amount = normalizeDistortionAmount(slot.audio?.distortion);
  audioDistortion.value = String(amount);
  audioDistortionValue.textContent = amount === 0 ? '0（OFF）' : amount + '%';
  const blob = slot.audio?.source ?? null;
  const videoAudio = slot.audio?.sourceFormat === 'video';
  audioEditor.hidden = !blob;
  useImageVideo.hidden = slot.visual?.sourceFormat !== 'video' || slot.audio?.source === slot.visual.source;
  if (blob === audioPreviewBlob && audioPreviewSlot === id) return;
  audioPreviewSlot = id;
  const token = ++audioDecodeToken;
  stopAudioPreview();
  if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
  audioPreviewUrl = null;
  audioPreviewBlob = blob;
  audioDecoded = null;
  audioStart.value = '0'; audioEnd.value = '0';
  audioRangeStatus.textContent = blob ? '音声を読み込み中…' : '';
  drawAudioWaveform();
  if (!blob) {
    audioPreview.removeAttribute('src');
    audioPreview.load();
    return;
  }
  audioPreview.removeAttribute('src');
  audioPreview.load();
  if (!videoAudio) {
    audioPreviewUrl = URL.createObjectURL(blob);
    audioPreview.src = audioPreviewUrl;
    audioPreview.load();
  }
  audioApplyButton.disabled = true;
  void (videoAudio ? decodeVideoAudio(blob) : decodeAudio(blob)).then(buffer => {
    if (token !== audioDecodeToken || audioPreviewBlob !== blob) return;
    audioDecoded = buffer;
    if (videoAudio) {
      audioPreviewUrl = URL.createObjectURL(audioBufferToWav(buffer));
      audioPreview.src = audioPreviewUrl;
      audioPreview.load();
    }
    audioApplyButton.disabled = false;
    audioEnd.value = String(buffer.duration);
    audioRangeStatus.textContent = '長さ：' + buffer.duration.toFixed(2) + '秒（波形を表示中）';
    drawAudioWaveform();
  }).catch(error => {
    if (token === audioDecodeToken) audioRangeStatus.textContent =
      (error instanceof Error ? error.message : '音声を読み取れませんでした。') + ' 切り抜きは利用できません。';
  });
}
audioPreview.addEventListener('loadedmetadata', () => {
  if (!Number.isFinite(audioPreview.duration) || audioDecoded) return;
  audioEnd.value = String(audioPreview.duration);
  drawAudioWaveform();
});
for (const field of [audioStart, audioEnd]) field.addEventListener('input', drawAudioWaveform);
audioDistortion.addEventListener('input', () => {
  const amount = normalizeDistortionAmount(audioDistortion.value);
  audioDistortionValue.textContent = amount === 0 ? '0（OFF）' : amount + '%';
});
audioDistortion.addEventListener('change', () => {
  const id = currentSlot();
  const asset = store.get(id).audio;
  if (!asset) return;
  const amount = normalizeDistortionAmount(audioDistortion.value);
  if (normalizeDistortionAmount(asset.distortion) === amount) return;
  const processed = null;
  store.update(id, { audio: { ...asset, distortion: amount, processed } });
  audioRangeStatus.textContent = amount === 0
    ? '音割れをOFFにしました。'
    : `音割れ ${amount}% を設定しました。「切り抜いてOGG保存」で適用してください。`;
  render();
  queueSave();
});
audioPreview.addEventListener('timeupdate', () => {
  if (rangePlayback && audioPreview.currentTime >= Number(audioEnd.value)) stopAudioPreview();
});
audioPreview.addEventListener('ended', stopAudioPreview);
get<HTMLButtonElement>('play-audio-range').addEventListener('click', async () => {
  const start = Number(audioStart.value), end = Number(audioEnd.value), duration = audioPreview.duration;
  try {
    sampleRange({ start, end }, duration, 44100);
  } catch (error) {
    audioRangeStatus.textContent = error instanceof Error ? error.message : '範囲が正しくありません。';
    return;
  }
  stopAudioPreview();
  audioPreview.currentTime = start;
  rangePlayback = true;
  try {
    await audioPreview.play();
    audioRangeStatus.textContent = start.toFixed(2) + '〜' + end.toFixed(2) + '秒を試聴中';
  } catch {
    rangePlayback = false;
    audioRangeStatus.textContent = '試聴できませんでした。ブラウザの音声設定を確認してください。';
  }
});
audioApplyButton.addEventListener('click', async () => {
  const id = currentSlot(), audio = store.get(id).audio;
  const selected = audio?.source;
  if (!audio || !selected || audioApplyButton.disabled) return;
  audioApplyButton.disabled = true;
  stopAudioPreview();
  try {
    const start = Number(audioStart.value), requestedEnd = Number(audioEnd.value);
    const distortion = normalizeDistortionAmount(audioDistortion.value);
    const decoded = audioDecoded && selected === audioPreviewBlob && audioPreviewSlot === id
      ? audioDecoded : await (audio.sourceFormat === 'video' ? decodeVideoAudio(selected) : decodeAudio(selected));
    // Container metadata may differ from decoded PCM duration by a few milliseconds.
    const end = requestedEnd > decoded.duration && requestedEnd - decoded.duration < 0.1
      ? decoded.duration : requestedEnd;
    sampleRange({ start, end }, decoded.duration, decoded.sampleRate);
    audioRangeStatus.textContent = distortion > 0 ? `音割れ ${distortion}% をかけてOGG Vorbisに変換中…` : '本物のOGG Vorbisに変換中…';
    const ogg = await encodeVorbisRange(decoded, { start, end }, fraction => {
      if (currentSlot() === id) audioRangeStatus.textContent =
        (distortion > 0 ? `音割れ ${distortion}% ＋ OGG変換中… ` : 'OGG Vorbisに変換中… ') + Math.round(fraction * 100) + '%';
    }, distortion);
    if (store.get(id).audio !== audio) return; // Source was removed or replaced while encoding.
    store.update(id, { audio: { ...audio, distortion, processed: { ogg } } });
    if (currentSlot() === id) {
      render();
      audioRangeStatus.textContent = 'OGG Vorbisを保存しました（' + ogg.size.toLocaleString() + ' bytes）。';
    }
    queueSave();
  } catch (error) {
    if (currentSlot() === id) audioRangeStatus.textContent =
      '変換失敗：' + (error instanceof Error ? error.message : '再度お試しください。') + ' 元のデータは保持しました。';
  } finally {
    audioApplyButton.disabled = !audioDecoded;
  }
});
window.addEventListener('pagehide', () => {
  stopAudioPreview();
  ++audioDecodeToken;
  if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
});

interface VideoFrameSelection { slotId: number; source: Blob; png: Blob; animation?: VideoAnimationRange }
let videoFrameSelection: VideoFrameSelection | null = null;
const videoEditor = get<HTMLElement>('video-editor');
const videoPreview = get<HTMLVideoElement>('video-preview');
const videoTimeInput = get<HTMLInputElement>('video-time');
const videoSeekInput = get<HTMLInputElement>('video-seek');
const videoCaptureButton = get<HTMLButtonElement>('capture-video');
const videoAnimationButton = get<HTMLButtonElement>('capture-video-animation');
const videoAnimationStart = get<HTMLInputElement>('video-animation-start');
const videoAnimationEnd = get<HTMLInputElement>('video-animation-end');
const videoAnimationCount = get<HTMLInputElement>('video-animation-count');
function setVideoCaptureDisabled(disabled: boolean): void {
  videoCaptureButton.disabled = disabled;
  videoAnimationButton.disabled = disabled;
}
const videoStatus = get<HTMLElement>('video-status');
let videoPreviewBlob: Blob | null = null;
let videoPreviewUrl: string | null = null;
let videoVersion = 0;

function releaseVideoPreview(): void {
  videoPreview.pause();
  if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
  videoPreviewUrl = null;
  videoPreviewBlob = null;
  videoPreview.removeAttribute('src');
  videoPreview.load();
}
function renderVideoEditor(id: number): void {
  const visual = store.get(id).visual;
  const source = visual?.sourceFormat === 'video' ? visual.source : null;
  videoEditor.hidden = !source;
  if (videoPreviewBlob === source) return;
  ++videoVersion;
  releaseVideoPreview();
  if (!source) return;
  videoPreviewBlob = source;
  setVideoCaptureDisabled(true);
  videoTimeInput.value = '0';
  videoAnimationStart.value = '0';
  videoAnimationEnd.value = '1';
  videoSeekInput.value = '0';
  videoSeekInput.max = '1';
  videoStatus.textContent = '動画の情報を読み込み中…';
  videoPreviewUrl = URL.createObjectURL(source);
  videoPreview.src = videoPreviewUrl;
  videoPreview.load();
}
videoPreview.addEventListener('loadedmetadata', () => {
  if (!videoPreviewBlob) return;
  try {
    const info = assertVideoInfo({
      width: videoPreview.videoWidth, height: videoPreview.videoHeight, duration: videoPreview.duration,
    });
    videoTimeInput.max = String(info.duration);
    videoSeekInput.max = String(info.duration);
    videoAnimationStart.max = String(info.duration);
    videoAnimationEnd.max = String(info.duration);
    videoAnimationEnd.value = String(Math.min(1, info.duration));
    setVideoCaptureDisabled(false);
    videoStatus.textContent = `動画：${info.width}×${info.height}px・${info.duration.toFixed(2)}秒。再生位置を指定してください。`;
  } catch (error) {
    setVideoCaptureDisabled(true);
    videoStatus.textContent = error instanceof Error ? error.message : '動画を開けません。';
  }
});
videoPreview.addEventListener('error', () => {
  if (videoPreviewBlob) {
    setVideoCaptureDisabled(true);
    videoStatus.textContent = 'このブラウザでは動画を再生できません。形式や映像コーデックを確認してください。';
  }
});
videoPreview.addEventListener('timeupdate', () => {
  if (!Number.isFinite(videoPreview.duration) || videoPreview.seeking) return;
  const t = String(videoPreview.currentTime);
  videoTimeInput.value = t;
  videoSeekInput.value = t;
});
function seekVideoFromInput(value: string): void {
  if (!videoPreviewBlob || !Number.isFinite(videoPreview.duration)) return;
  try {
    const t = frameTime(Number(value), videoPreview.duration);
    videoPreview.pause();
    videoPreview.currentTime = t;
    videoSeekInput.value = String(t);
    videoTimeInput.value = String(t);
  } catch (error) {
    videoStatus.textContent = error instanceof Error ? error.message : '再生位置を確認してください。';
  }
}
videoSeekInput.addEventListener('input', () => seekVideoFromInput(videoSeekInput.value));
videoTimeInput.addEventListener('change', () => seekVideoFromInput(videoTimeInput.value));
async function selectVideoFrames(animation?: VideoAnimationRange): Promise<void> {
  const id = currentSlot();
  const visual = store.get(id).visual;
  if (visual?.sourceFormat !== 'video' || videoCaptureButton.disabled || videoPreviewBlob !== visual.source) return;
  const version = videoVersion;
  const t = animation?.start ?? Number(videoTimeInput.value);
  setVideoCaptureDisabled(true);
  videoStatus.textContent = '指定フレームをPNGに変換中…';
  try {
    const png = await captureVideoFrame(videoPreview, t);
    if (version !== videoVersion || store.get(id).visual !== visual || currentSlot() !== id) return;
    videoFrameSelection = { slotId: id, source: visual.source, png, animation };
    clearGifPreview();
    render();
    videoStatus.textContent = animation
      ? `${animation.start.toFixed(2)}〜${animation.end.toFixed(2)}秒を選択しました。下の画像編集で全フレームに加工を適用できます。`
      : `${t.toFixed(2)}秒のフレームを取得しました。下の画像編集で切り抜き・透過・エフェクトを適用できます。`;
    if (!editorPanel.hidden && activeEditorTab === 'image') imageEditorPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (error) {
    if (version === videoVersion) videoStatus.textContent = '取得に失敗：' +
      (error instanceof Error ? error.message : '動画フレームを確認してください。');
  } finally {
    if (version === videoVersion) setVideoCaptureDisabled(false);
  }
}
videoCaptureButton.addEventListener('click', () => void selectVideoFrames());
videoAnimationButton.addEventListener('click', () => {
  try {
    const animation = { start: Number(videoAnimationStart.value), end: Number(videoAnimationEnd.value), count: Number(videoAnimationCount.value) };
    videoAnimationPlan(animation, videoPreview.duration);
    void selectVideoFrames(animation);
  } catch (error) {
    videoStatus.textContent = error instanceof Error ? error.message : '範囲を確認してください。';
  }
});
get<HTMLButtonElement>('video-start-here').addEventListener('click', () => {
  if (videoPreviewBlob && Number.isFinite(videoPreview.duration)) videoAnimationStart.value = String(videoPreview.currentTime);
});
get<HTMLButtonElement>('video-end-here').addEventListener('click', () => {
  if (videoPreviewBlob && Number.isFinite(videoPreview.duration)) videoAnimationEnd.value = String(videoPreview.currentTime);
});
window.addEventListener('pagehide', releaseVideoPreview);

const preview = get<HTMLImageElement>('preview');
const imageEditorPanel = get<HTMLElement>('image-editor');
const sourceCanvas = get<HTMLCanvasElement>('source-canvas');
const processedPreview = get<HTMLCanvasElement>('processed-preview');
const gamingMode = get<HTMLSelectElement>('gaming-mode');
const gamingDirection = get<HTMLSelectElement>('gaming-direction');
const gamingDirectionLabel = get<HTMLElement>('gaming-direction-label');
const enchantEnabled = get<HTMLInputElement>('enchant-enabled');
const enchantStrength = get<HTMLInputElement>('enchant-strength');
const enchantStrengthLabel = get<HTMLElement>('enchant-strength-label');
const enchantStrengthValue = get<HTMLSpanElement>('enchant-strength-value');
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let previewVersion = 0;
const cropInfo = get<HTMLElement>('crop-info');
const imageEditStatus = get<HTMLElement>('image-edit-status');
const cropFields = ['crop-x','crop-y','crop-width','crop-height'] as const;
let activeBitmap: ImageBitmap | null = null;
let bitmapSlot = 0;
let bitmapSource: Blob | null = null;
let editToken = 0;
const gifLiveCanvas = get<HTMLCanvasElement>('gif-live-canvas');
const gifLiveStatus = get<HTMLParagraphElement>('gif-live-status');
const gifLiveFrame = get<HTMLSpanElement>('gif-live-frame');
const gifLiveToggle = get<HTMLButtonElement>('gif-live-toggle');
const gifLiveSpeed = get<HTMLSelectElement>('gif-live-speed');
const gifLiveLoop = get<HTMLInputElement>('gif-live-loop');
const gifPlayer = new GifPreviewPlayer(gifLiveCanvas, (frame, total, playing) => {
  gifLiveToggle.disabled = total === 0;
  gifLiveToggle.textContent = playing ? '一時停止' : '再生';
  gifLiveFrame.textContent = total ? `フレーム：${frame + 1} / ${total}` : 'フレーム：―';
});
let gifSource: Blob | null = null;
let gifTotalFrames = 0;
let gifPreviewKey: string | null = null;
let gifPreviewVersion = 0;
let gifPreviewAbort: AbortController | null = null;
let gifPreviewTimer: ReturnType<typeof setTimeout> | null = null;

function clearGifPreview(forgetSource = false): void {
  ++gifPreviewVersion;
  if (gifPreviewTimer !== null) clearTimeout(gifPreviewTimer);
  gifPreviewTimer = null;
  gifPreviewAbort?.abort();
  gifPreviewAbort = null;
  gifPreviewKey = null;
  gifPlayer.clear();
  if (forgetSource) {
    gifSource = null;
    gifTotalFrames = 0;
  }
}

function visualEffectSettings(): VisualEffectSettings {
  return normalizeVisualEffects({
    gamingMode: gamingMode.value as GamingMode,
    gamingDirection: gamingDirection.value as GamingDirection,
    enchant: enchantEnabled.checked,
    enchantStrength: Number(enchantStrength.value),
  });
}

function effectSummary(settings: VisualEffectSettings): string {
  const parts: string[] = [];
  if (settings.gamingMode === 'global') parts.push('🌈全体ゲーミング');
  if (settings.gamingMode === 'diagonal') {
    const arrows: Record<GamingDirection, string> = { 'tl-br': '↘', 'tr-bl': '↙', 'bl-tr': '↗', 'br-tl': '↖' };
    parts.push('🌈斜めゲーミング' + arrows[settings.gamingDirection]);
  }
  if (settings.enchant) parts.push('✨エンチャント風' + settings.enchantStrength + '%');
  return parts.join('＋');
}

function refreshEffectControls(): void {
  gamingDirectionLabel.hidden = gamingMode.value !== 'diagonal';
  enchantStrengthLabel.hidden = !enchantEnabled.checked;
  enchantStrengthValue.textContent = normalizeVisualEffects({
    gamingMode: gamingMode.value as GamingMode,
    gamingDirection: gamingDirection.value as GamingDirection,
    enchant: enchantEnabled.checked,
    enchantStrength: Number(enchantStrength.value),
  }).enchantStrength + '%';
}

function scheduleGifPreview(): void {
  if (get<HTMLElement>('editor-panel').hidden || activeEditorTab !== 'image' || !activeBitmap) return;
  const id = currentSlot();
  const visual = store.get(id).visual;
  const videoRange = visual?.sourceFormat === 'video' && videoFrameSelection?.slotId === id &&
    videoFrameSelection.source === visual.source && videoFrameSelection.png === bitmapSource
      ? videoFrameSelection.animation : undefined;
  const isGif = visual?.sourceFormat === 'gif' && visual.source === gifSource && bitmapSource === gifSource && gifTotalFrames > 0;
  if (!visual || (!isGif && !videoRange)) return;
  const range = {
    first: Number(get<HTMLInputElement>('gif-start').value),
    last: Number(get<HTMLInputElement>('gif-end').value),
  };
  if (isGif && !validFrameRange(range, gifTotalFrames)) {
    clearGifPreview();
    gifLiveStatus.textContent = `フレーム範囲は1〜${gifTotalFrames}の間で開始 ≤ 終了にしてください。`;
    return;
  }
  const settings = imageSettings();
  const effects = visualEffectSettings();
  const key = JSON.stringify({ id, range: videoRange ?? range, settings, effects });
  if (gifPreviewKey === key) return;
  clearGifPreview();
  gifPreviewKey = key;
  const version = gifPreviewVersion;
  const controller = new AbortController();
  gifPreviewAbort = controller;
  const source = visual.source;
  gifLiveStatus.textContent = '加工後のアニメーションプレビューを生成中…';
  gifPreviewTimer = setTimeout(async () => {
    gifPreviewTimer = null;
    try {
      // Exact same compositing, cropping, keying and Minecraft tick timing as GIF export.
      const result = videoRange
        ? await processVideoAnimation(source, settings, videoRange, undefined, controller.signal, effects)
        : await processGif(source, settings, range, undefined, controller.signal, effects);
      if (controller.signal.aborted || version !== gifPreviewVersion ||
          currentSlot() !== id || get<HTMLElement>('editor-panel').hidden ||
          store.get(id).visual?.source !== source) return;
      const ticks = previewTicksFromMcmeta(result.animationMcmeta, result.frameCount);
      const sprite = await createImageBitmap(result.png);
      if (controller.signal.aborted || version !== gifPreviewVersion ||
          currentSlot() !== id || get<HTMLElement>('editor-panel').hidden ||
          store.get(id).visual?.source !== source) { sprite.close(); return; }
      gifPlayer.setFrames(sprite, ticks);
      gifLiveStatus.textContent = `加工後の${result.frameCount}フレームを再生中。速度${gifLiveSpeed.value}倍はスロットに保存され、ZIP出力にも反映します。`;
    } catch (error) {
      if (!controller.signal.aborted && version === gifPreviewVersion) {
        gifPreviewKey = null;
        gifLiveStatus.textContent = 'プレビュー生成失敗：' +
          (error instanceof Error ? error.message : '画像を確認してください。');
      }
    }
  }, 350);
}
gifLiveToggle.addEventListener('click', () => gifPlayer.toggle());
gifLiveSpeed.addEventListener('change', () => {
  const visual = store.get(currentSlot()).visual;
  if (!visual || (visual.sourceFormat !== 'gif' && visual.sourceFormat !== 'video')) return;
  const speed = normalizeGifSpeed(Number(gifLiveSpeed.value));
  gifPlayer.setSpeed(speed);
  store.update(currentSlot(), { visual: { ...visual, animationSpeed: speed } });
  gifLiveStatus.textContent = `速度${speed}倍を保存中。プレビューと出力ZIPの両方に同じ50ms単位で反映します。`;
  queueSave();
});
gifLiveLoop.addEventListener('change', () => gifPlayer.setLoop(gifLiveLoop.checked));
get<HTMLInputElement>('gif-start').addEventListener('input', scheduleGifPreview);
get<HTMLInputElement>('gif-end').addEventListener('input', scheduleGifPreview);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) gifPlayer.pause();
});
window.addEventListener('pagehide', () => clearGifPreview(true));

function imageSettings(): ImageEditSettings {
  const number = (id: string) => Number(get<HTMLInputElement>(id).value);
  return { x: number('crop-x'), y: number('crop-y'), width: number('crop-width'), height: number('crop-height'),
    keyEnabled: get<HTMLInputElement>('key-enabled').checked, keyColor: get<HTMLInputElement>('key-color').value,
    tolerance: number('key-tolerance'), feather: number('key-feather'),
    resolution: number('image-resolution') === 128 ? 128 : 256 };
}
function updateCropInfo(): void {
  if (!activeBitmap) return;
  const bounds = cropBounds(imageSettings(), activeBitmap.width, activeBitmap.height);
  cropInfo.textContent = `切り抜き範囲：(${bounds.x}, ${bounds.y}) / ${bounds.width}×${bounds.height}px。元画像 ${activeBitmap.width}×${activeBitmap.height}px`;
  const context = sourceCanvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  context.drawImage(activeBitmap, 0, 0);
  context.strokeStyle = '#ff00ff'; context.lineWidth = Math.max(2, sourceCanvas.width / 250);
  context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  schedulePreview();
}
function schedulePreview(): void {
  clearTimeout(previewTimer);
  const version = ++previewVersion;
  const bitmap = activeBitmap;
  if (!bitmap) return;
  scheduleGifPreview();
  previewTimer = setTimeout(async () => {
    try {
      let png = await processPng(bitmap, imageSettings());
      if (version !== previewVersion || bitmap !== activeBitmap) return;
      const effects = visualEffectSettings();
      if (hasAnimatedVisualEffects(effects)) png = await applyVisualEffectsFramePng(png, 0, effects);
      if (version !== previewVersion || bitmap !== activeBitmap) return;
      const image = await createImageBitmap(png);
      if (version !== previewVersion || bitmap !== activeBitmap) { image.close(); return; }
      processedPreview.width = image.width; processedPreview.height = image.height;
      const context = processedPreview.getContext('2d');
      context?.drawImage(image, 0, 0);
      image.close();
    } catch (error) {
      if (version === previewVersion) imageEditStatus.textContent = error instanceof Error ? error.message : 'プレビューに失敗しました。';
    }
  }, 180);
}
async function renderImageEditor(id: number): Promise<void> {
  const token = ++editToken;
  if (get<HTMLElement>('editor-panel').hidden) {
    clearGifPreview();
    return;
  }
  const slot = store.get(id);
  const savedEffects = normalizeVisualEffects(slot.visual?.effects, Boolean(slot.visual?.gaming));
  gamingMode.value = savedEffects.gamingMode;
  gamingDirection.value = savedEffects.gamingDirection;
  enchantEnabled.checked = savedEffects.enchant;
  enchantStrength.value = String(savedEffects.enchantStrength);
  refreshEffectControls();
  // Restore the selected slot's saved speed (including after reload/copy/move).
  const savedSpeed = normalizeGifSpeed(slot.visual?.animationSpeed);
  gifLiveSpeed.value = String(savedSpeed);
  gifPlayer.setSpeed(savedSpeed);
  const nextGifSource = slot.visual?.sourceFormat === 'gif' ? slot.visual.source : null;
  if (gifSource !== nextGifSource) {
    clearGifPreview(true);
    gifSource = nextGifSource;
  }
  const editSource = slot.visual?.sourceFormat === 'video'
    ? (videoFrameSelection?.slotId === id && videoFrameSelection.source === slot.visual.source ? videoFrameSelection.png : null)
    : slot.visual?.source;
  if (!slot.visual || !editSource) {
    clearGifPreview();
    imageEditorPanel.hidden = true;
    get<HTMLElement>('gif-range').hidden = true;
    get<HTMLElement>('animation-live-panel').hidden = true;
    clearTimeout(previewTimer); ++previewVersion;
    activeBitmap?.close(); activeBitmap = null; bitmapSource = null;
    return;
  }
  imageEditorPanel.hidden = false;
  get<HTMLElement>('gif-range').hidden = slot.visual.sourceFormat !== 'gif';
  get<HTMLElement>('animation-live-panel').hidden = slot.visual.sourceFormat !== 'gif' &&
    !(videoFrameSelection?.slotId === id && videoFrameSelection.source === slot.visual.source && videoFrameSelection.animation);
  if (bitmapSlot === id && bitmapSource === editSource && activeBitmap) { updateCropInfo(); return; }
  clearGifPreview();
  gifLiveStatus.textContent = 'フレームを確認中…';
  activeBitmap?.close(); activeBitmap = null;
  imageEditStatus.textContent = '元画像を読み込み中…';
  try {
    const bitmap = await loadPng(editSource);
    if (token !== editToken || currentSlot() !== id) { bitmap.close(); return; }
    activeBitmap = bitmap; bitmapSlot = id; bitmapSource = editSource;
    sourceCanvas.width = bitmap.width; sourceCanvas.height = bitmap.height;
    const defaults = defaultImageSettings(bitmap.width, bitmap.height);
    for (const [key, value] of Object.entries({ 'crop-x': defaults.x, 'crop-y': defaults.y, 'crop-width': defaults.width, 'crop-height': defaults.height })) {
      get<HTMLInputElement>(key).value = String(value);
    }
    if (slot.visual.sourceFormat === 'gif') {
      const info = await inspectGif(slot.visual.source);
      if (token !== editToken || currentSlot() !== id) return;
      get<HTMLInputElement>('gif-start').value = '1';
      get<HTMLInputElement>('gif-end').value = String(info.count);
      gifTotalFrames = info.count;
      get<HTMLElement>('gif-info').textContent = `GIF：${info.width}×${info.height}px、${info.count}フレーム`;
    }
    updateCropInfo();
    imageEditStatus.textContent = '範囲を指定して「画像編集を適用」を押してください。';
  } catch (error) {
    imageEditStatus.textContent = error instanceof Error ? error.message : '画像を開けませんでした。';
  }
}
for (const id of cropFields) get<HTMLInputElement>(id).addEventListener('input', updateCropInfo);
for (const id of ['key-enabled', 'key-color', 'key-tolerance', 'key-feather', 'image-resolution']) {
  get<HTMLInputElement>(id).addEventListener('input', schedulePreview);
}
function saveVisualEffectsFromControls(): void {
  refreshEffectControls();
  const id = currentSlot();
  const visual = store.get(id).visual;
  if (!visual) return;
  const effects = visualEffectSettings();
  store.update(id, {
    visual: { ...visual, effects, gaming: effects.gamingMode !== 'off', processed: null },
  });
  imageEditStatus.textContent = hasAnimatedVisualEffects(effects)
    ? effectSummary(effects) + ' を設定しました。画像編集を適用すると動く素材として保存されます。'
    : '動く画像エフェクトをOFFにしました。画像編集を適用して保存してください。';
  render();
  queueSave();
  schedulePreview();
}
for (const control of [gamingMode, gamingDirection, enchantEnabled, enchantStrength]) {
  control.addEventListener('input', () => {
    refreshEffectControls();
    if (control === enchantStrength) schedulePreview();
  });
  control.addEventListener('change', saveVisualEffectsFromControls);
}
function canvasPosition(event: PointerEvent): { x: number; y: number } {
  const rect = sourceCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(sourceCanvas.width - 1, Math.floor((event.clientX - rect.left) * sourceCanvas.width / rect.width))),
    y: Math.max(0, Math.min(sourceCanvas.height - 1, Math.floor((event.clientY - rect.top) * sourceCanvas.height / rect.height))),
  };
}
let dragStart: { x: number; y: number } | null = null;
sourceCanvas.addEventListener('pointerdown', event => {
  if (!activeBitmap || event.button !== 0) return;
  dragStart = canvasPosition(event);
  sourceCanvas.setPointerCapture(event.pointerId);
});
sourceCanvas.addEventListener('pointerup', event => {
  if (!activeBitmap || !dragStart) return;
  const start = dragStart;
  dragStart = null;
  const end = canvasPosition(event);
  if (Math.abs(end.x - start.x) < 3 && Math.abs(end.y - start.y) < 3) {
    const color = sampleColor(activeBitmap, end.x, end.y);
    get<HTMLInputElement>('key-color').value = color;
    get<HTMLInputElement>('key-enabled').checked = true;
    imageEditStatus.textContent = `スポイトで ${color} を選択しました。`;
    schedulePreview();
    return;
  }
  const bounds = {
    x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x) + 1, height: Math.abs(end.y - start.y) + 1,
  };
  for (const [key, value] of Object.entries({
    'crop-x': bounds.x, 'crop-y': bounds.y,
    'crop-width': bounds.width, 'crop-height': bounds.height,
  })) get<HTMLInputElement>(key).value = String(value);
  updateCropInfo();
});
sourceCanvas.addEventListener('pointercancel', () => { dragStart = null; });
get<HTMLButtonElement>('apply-image').addEventListener('click', async () => {
  if (!activeBitmap || bitmapSlot !== currentSlot()) return;
  const id = currentSlot(), source = bitmapSource, bitmap = activeBitmap;
  const button = get<HTMLButtonElement>('apply-image');
  if (button.disabled) return;
  const settings = imageSettings();
  const version = editToken;
  button.disabled = true; imageEditStatus.textContent = '画像を処理中…';
  try {
    const visual = store.get(id).visual!;
    const unchanged = () => id === currentSlot() && !editorPanel.hidden && activeEditorTab === 'image' &&
      version === editToken && store.get(id).visual === visual &&
      (visual.sourceFormat === 'video' ? videoFrameSelection?.png === source : visual.source === source);
    const videoRange = visual.sourceFormat === 'video' && videoFrameSelection?.slotId === id &&
      videoFrameSelection.source === visual.source ? videoFrameSelection.animation : undefined;
    if (videoRange) {
      const result = await processVideoAnimation(visual.source, settings, videoRange, fraction => {
        if (unchanged()) imageEditStatus.textContent = '動画アニメーション変換中…' + Math.round(fraction * 100) + '%';
      }, undefined, normalizeVisualEffects(visual.effects, Boolean(visual.gaming)));
      if (!unchanged()) return;
      store.update(id, { visual: { ...visual, processed: {
        png: result.png, previewPng: result.previewPng, animationMcmeta: result.animationMcmeta,
      } } });
      render(); queueSave();
      imageEditStatus.textContent = `動画から${result.frameCount}フレームのアニメーション素材を登録しました。`;
    } else if (visual.sourceFormat === 'gif') {
      const result = await processGif(visual.source, settings, {
        first: Number(get<HTMLInputElement>('gif-start').value),
        last: Number(get<HTMLInputElement>('gif-end').value),
      }, fraction => {
        if (currentSlot() === id) {
          const effects = normalizeVisualEffects(visual.effects, Boolean(visual.gaming));
          imageEditStatus.textContent = (hasAnimatedVisualEffects(effects) ? 'エフェクト付きGIF変換中…' : 'GIF変換中…') + Math.round(fraction * 100) + '%';
        }
      }, undefined, normalizeVisualEffects(visual.effects, Boolean(visual.gaming)));
      if (!unchanged()) return;
      store.update(id, { visual: { ...visual, processed: {
        png: result.png, previewPng: result.previewPng, animationMcmeta: result.animationMcmeta,
      } } });
      render(); queueSave();
      imageEditStatus.textContent = `GIF ${result.frameCount}フレームのアニメーションPNGを登録しました。`;
    } else {
      const png = await processPng(bitmap, settings);
      if (!unchanged()) return;
      const effects = normalizeVisualEffects(visual.effects, Boolean(visual.gaming));
      if (hasAnimatedVisualEffects(effects)) {
        imageEditStatus.textContent = effectSummary(effects) + ' のアニメーションを生成中…';
        const result = await createVisualEffectAnimation(png, effects);
        if (!unchanged()) return;
        store.update(id, { visual: { ...visual, effects, gaming: effects.gamingMode !== 'off', processed: {
          png: result.png, previewPng: result.previewPng, animationMcmeta: result.animationMcmeta,
        } } });
        render(); queueSave();
        imageEditStatus.textContent = `${effectSummary(effects)}：静止画を${result.frameCount}フレームのアニメーション素材として登録しました。`;
      } else {
        store.update(id, { visual: { ...visual, processed: { png } } });
        render(); queueSave();
        imageEditStatus.textContent = `編集済みPNGを登録しました（${png.size.toLocaleString()} bytes）。`;
      }
    }
  } catch (error) {
    imageEditStatus.textContent = error instanceof Error ? error.message : '画像処理に失敗しました。';
  } finally { button.disabled = false; }
});
const previewLabel = get<HTMLSpanElement>('preview-label');
const imageName = get<HTMLParagraphElement>('image-name');
const soundName = get<HTMLParagraphElement>('sound-name');
const slotState = get<HTMLParagraphElement>('slot-state');
const summaryLabel = get<HTMLParagraphElement>('summary');
const exportState = get<HTMLParagraphElement>('export-state');
const feedback = get<HTMLParagraphElement>('feedback');
const editorPanel = get<HTMLElement>('editor-panel');
const inventoryRoot = get<HTMLElement>('inventory-root');
const inventoryHelp = document.querySelector<HTMLElement>('.inventory-help');
const editorHeading = get<HTMLElement>('editor-heading');
const prevButton = get<HTMLButtonElement>('prev-slot');
const nextButton = get<HTMLButtonElement>('next-slot');
const editorTabs = ['image', 'audio'] as const;
const editorTabNav = get<HTMLElement>('editor-tab-nav');
const editorTabButtons = [...editorTabNav.querySelectorAll<HTMLButtonElement>('[data-editor-tab]')];
let activeEditorTab: EditorTab = 'image';

function refreshEditorGuide(): void {
  const slot = store.get(currentSlot());
  const hasFrame = videoFrameSelection?.slotId === slot.id &&
    videoFrameSelection.source === slot.visual?.source;
  const guide = editorTabGuide(slot, Boolean(hasFrame));
  get<HTMLElement>('editor-next-action').textContent = guide.nextAction;
  get<HTMLElement>('editor-shortname').textContent = slot.name.trim() || '名前未設定';
  get<HTMLElement>('editor-btn-image').dataset.state = guide.imageState;
  get<HTMLElement>('editor-btn-audio').dataset.state = guide.audioState;
}

function activateEditorTab(tab: EditorTab, scrollToTabs = false): void {
  if (activeEditorTab === 'image' && tab !== 'image') {
    ++editToken;
    clearGifPreview();
    clearTimeout(previewTimer);
    ++previewVersion;
    activeBitmap?.close();
    activeBitmap = null;
    bitmapSource = null;
    bitmapSlot = 0;
  }
  if (tab !== 'audio') stopAudioPreview();
  if (tab !== 'image') videoPreview.pause();
  activeEditorTab = tab;
  for (const key of editorTabs) {
    const selected = key === tab;
    const button = get<HTMLButtonElement>('editor-btn-' + key);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    get<HTMLElement>('editor-tab-' + key).hidden = !selected;
  }
  refreshEditorGuide();
  const id = currentSlot();
  if (tab === 'image') {
    renderVideoEditor(id);
    void renderImageEditor(id);
  }
  if (tab === 'audio') renderAudioEditor(id);
  if (scrollToTabs) editorTabNav.scrollIntoView({ block: 'start' });
}
for (const button of editorTabButtons) {
  button.addEventListener('click', () => activateEditorTab(button.dataset.editorTab as EditorTab));
  button.addEventListener('keydown', event => {
    const index = editorTabs.indexOf(button.dataset.editorTab as EditorTab);
    const target = event.key === 'ArrowRight' ? (index + 1) % editorTabs.length
      : event.key === 'ArrowLeft' ? (index + editorTabs.length - 1) % editorTabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? editorTabs.length - 1 : -1;
    if (target === -1) return;
    event.preventDefault();
    const nextTab = editorTabs[target];
    activateEditorTab(nextTab);
    get<HTMLButtonElement>('editor-btn-' + nextTab).focus();
  });
}
function openEditor(id: number): void {
  const fromInventory = editorPanel.hidden;
  if (id !== currentSlot()) {
    stopAudioPreview();
    videoFrameSelection = null;
    ++videoVersion;
    releaseVideoPreview();
  }
  slotSelect.value = String(id);
  editorPanel.hidden = false;
  inventoryRoot.hidden = true;
  if (inventoryHelp) inventoryHelp.hidden = true;
  feedback.textContent = '';
  if (fromInventory) activateEditorTab('image');
  render();
  editorPanel.scrollIntoView({ block: 'start' });
}
function showInventory(): void {
  stopAudioPreview();
  videoPreview.pause();
  ++editToken;
  clearGifPreview();
  clearTimeout(previewTimer);
  ++previewVersion;
  activeBitmap?.close();
  activeBitmap = null;
  bitmapSource = null;
  bitmapSlot = 0;
  editorPanel.hidden = true;
  inventoryRoot.hidden = false;
  if (inventoryHelp) inventoryHelp.hidden = false;
  render();
  inventoryRoot.scrollIntoView({ block: 'start' });
}
const inventory = mountInventory(inventoryRoot, store, openEditor, () => {
  // The store transfer modifies one or two slots; persist the whole snapshot atomically.
  ++imageUploadVersion;
  ++audioUploadVersion;
  videoFrameSelection = null;
  render();
  queueSave();
});
let previewUrl: string | null = null;

const statusLabels = {
  empty: '未設定',
  partial: '設定途中',
  complete: '素材準備完了',
} as const;

function currentSlot(): number {
  return Number(slotSelect.value);
}

function render(): void {
  const slot = store.get(currentSlot());
  const state = slotStatus(slot);
  const summary = store.summary();
  inventory.render(currentSlot());
  editorHeading.textContent = 'Slot ' + String(slot.id).padStart(2, '0') + ' / ' + SLOT_COUNT;
  prevButton.disabled = slot.id === 1;
  nextButton.disabled = slot.id === SLOT_COUNT;
  nameInput.value = slot.name;
  imageInput.value = '';
  imageVideoInput.value = '';
  soundInput.value = '';
  soundVideoInput.value = '';
  slotState.textContent = `Slot ${String(slot.id).padStart(2, '0')}：${statusLabels[state]}`;
  slotState.dataset.state = state;
  const visualNotes: string[] = [];
  if (slot.visual?.sourceFormat === 'video') visualNotes.push(slot.visual.processed?.animationMcmeta ? 'アニメーション処理済み' : slot.visual.processed ? '静止画処理済み' : 'フレーム編集待ち');
  if (slot.visual) {
    const effects = normalizeVisualEffects(slot.visual.effects, Boolean(slot.visual.gaming));
    if (hasAnimatedVisualEffects(effects)) {
      visualNotes.push(slot.visual.processed?.animationMcmeta ? effectSummary(effects) : effectSummary(effects) + '未適用');
    }
  }
  imageName.textContent = `画像：${slot.visual?.sourceName ?? '未登録'}${visualNotes.length ? '（' + visualNotes.join('・') + '）' : ''}`;
  const distortion = normalizeDistortionAmount(slot.audio?.distortion);
  const soundNotes: string[] = [];
  if (slot.audio?.sourceFormat === 'mp3' || slot.audio?.sourceFormat === 'video') soundNotes.push(slot.audio.processed ? 'OGG変換済み' : '未変換');
  if (distortion > 0) soundNotes.push(slot.audio?.processed ? `音割れ${distortion}%` : `音割れ${distortion}%未適用`);
  soundName.textContent = `音声：${slot.audio?.sourceName ?? '未登録'}${soundNotes.length ? '（' + soundNotes.join('・') + '）' : ''}`;
  refreshEditorGuide();
  summaryLabel.textContent = `完成 ${summary.complete}枠 ／ 設定途中 ${summary.partial}枠 ／ 未設定 ${summary.empty}枠`;
  get<HTMLButtonElement>('download').disabled = !summary.canExport;
  exportState.textContent = summary.canExport
    ? '完成枠をまとめて素材ZIPに保存できます（MOD用の完成リソースパックではありません）。'
    : summary.partial > 0
      ? `設定途中の${summary.partial}枠を完成させるか削除すると書き出し条件を満たせます。`
      : '少なくとも1枠に画像と音声を揃えてください。';
  if (!editorPanel.hidden && activeEditorTab === 'image') {
    renderVideoEditor(slot.id);
    void renderImageEditor(slot.id);
  }
  if (!editorPanel.hidden && activeEditorTab === 'audio') renderAudioEditor(slot.id);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  if (slot.visual?.processed?.png) {
    previewUrl = URL.createObjectURL(slot.visual.processed.previewPng ?? slot.visual.processed.png);
    preview.src = previewUrl;
    preview.hidden = false;
    previewLabel.textContent = '登録済み画像';
  } else {
    preview.removeAttribute('src');
    preview.hidden = true;
    previewLabel.textContent = '画像未登録';
  }
}

get<HTMLButtonElement>('download').addEventListener('click', async () => {
  const button = get<HTMLButtonElement>('download');
  if (!store.summary().canExport || button.disabled) return;
  button.disabled = true;
  exportState.textContent = '完成枠の素材ZIPを検証・生成中…';
  try {
    const zip = await buildAssetArchive(store.list());
    const url = URL.createObjectURL(zip);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'runes-nextbot-assets.zip';
      document.body.append(link);
      link.click();
      link.remove();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    exportState.textContent = '素材ZIPを生成しました。Minecraft用リソースパックではありません。';
  } catch (error) {
    exportState.textContent = 'ZIP生成失敗：' + (error instanceof Error ? error.message : '不明なエラー');
  } finally {
    button.disabled = !store.summary().canExport;
  }
});

get<HTMLButtonElement>('back-list').addEventListener('click', showInventory);
prevButton.addEventListener('click', () => { if (currentSlot() > 1) openEditor(currentSlot() - 1); });
nextButton.addEventListener('click', () => { if (currentSlot() < SLOT_COUNT) openEditor(currentSlot() + 1); });

slotSelect.addEventListener('change', () => {
  feedback.textContent = '';
  videoFrameSelection = null;
  ++videoVersion;
  releaseVideoPreview();
  render();
});

nameInput.addEventListener('input', () => {
  store.update(currentSlot(), { name: nameInput.value });
  refreshEditorGuide();
  inventory.render(currentSlot());
  queueSave();
});

let imageUploadVersion = 0;
// iOS Photos can supply JPEG/HEIC regardless of the original photo format.
// Normalize still images to PNG so all existing crop/effect/export paths work.
async function normalizeUploadedPhoto(file: File): Promise<Blob> {
  if (file.size < 1 || file.size > 32 * 1024 * 1024) {
    throw new Error('画像は32MiB以下にしてください。');
  }
  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;
  let url: string | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      // Safari may support a photo format in HTMLImageElement but not ImageBitmap.
      url = URL.createObjectURL(file);
      image = new Image();
      const img = image;
      const src = url;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => finish(false), 15000);
        function finish(ok: boolean): void {
          window.clearTimeout(timer);
          img.onload = null;
          img.onerror = null;
          if (ok) resolve();
          else reject(new Error('写真を読み込めません。この端末でHEICが非対応の場合はJPEGまたはPNGを選択してください。'));
        }
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = src;
      });
    }
    const width = bitmap ? bitmap.width : image!.naturalWidth;
    const height = bitmap ? bitmap.height : image!.naturalHeight;
    if (!width || !height) throw new Error('画像の大きさを取得できませんでした。');
    const scale = Math.min(1, 4096 / width, 4096 / height, Math.sqrt(8_000_000 / (width * height)));
    if (scale === 1 && file.size <= 16 * 1024 * 1024 && await isPng(file)) return file;
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('画像を変換できませんでした。');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap ?? image!, 0, 0, canvas.width, canvas.height);
    const output = canvas;
    return await new Promise<Blob>((resolve, reject) => {
      output.toBlob(blob => blob && blob.size > 0 ? resolve(blob) :
        reject(new Error('写真のPNG変換に失敗しました。')), 'image/png');
    });
  } finally {
    bitmap?.close();
    if (image) image.removeAttribute('src');
    if (url) URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}
async function registerVisual(file: File): Promise<void> {
  const id = currentSlot();
  const version = ++imageUploadVersion;
  const previous = store.get(id).visual;
  feedback.textContent = '画像・動画を確認中…';
  try {
    const header = new Uint8Array(await file.slice(0, 6).arrayBuffer());
    const gifSignature = String.fromCharCode(...header);
    if (gifSignature === 'GIF87a' || gifSignature === 'GIF89a') {
      const info = await inspectGif(file);
      if (version !== imageUploadVersion || store.get(id).visual !== previous) return;
      videoFrameSelection = null;
      store.update(id, { visual: {
        sourceName: file.name, sourceFormat: 'gif', source: file, gaming: false, effects: defaultVisualEffectSettings(), processed: null,
      } });
      if (currentSlot() === id) feedback.textContent = `Slot ${id}にGIF（${info.count}フレーム）を登録しました。`;
    } else {
      const png = await normalizeUploadedPhoto(file);
      if (version !== imageUploadVersion || store.get(id).visual !== previous) return;
      if (currentSlot() === id) videoFrameSelection = null;
      store.update(id, { visual: {
        sourceName: file.name, sourceFormat: 'png', source: png, gaming: false, effects: defaultVisualEffectSettings(), processed: { png },
      } });
      if (currentSlot() === id) feedback.textContent = png === file
        ? `Slot ${id}にPNGを登録しました。`
        : `Slot ${id}に写真をPNG変換して登録しました。`;
    }
  } catch (error) {
    if (version === imageUploadVersion && currentSlot() === id) feedback.textContent =
      error instanceof Error ? error.message : '画像・動画を読み取れませんでした。';
    return;
  }
  if (currentSlot() === id && !editorPanel.hidden) {
    render();
    activateEditorTab('image', true);
  } else inventory.render(currentSlot());
  queueSave();
}
imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  imageInput.value = '';
  if (file) void registerVisual(file);
});

// Both upload controls share one immutable source. Each successful track is
// registered independently; an unsupported track never erases existing data.
async function registerUploadedVideo(file: File): Promise<void> {
  const id = currentSlot();
  const previous = store.get(id);
  if (!isVideoFilename(file.name)) {
    feedback.textContent = 'MP4 / WebM / MOVを選択してください。';
    return;
  }
  if ((previous.visual || previous.audio) &&
      !window.confirm('このスロットの画像・音声を新しい動画の素材に置き換えますか？ 読み込めない側の元データは保持します。')) return;
  const visualVersion = ++imageUploadVersion;
  const soundVersion = ++audioUploadVersion;
  feedback.textContent = '動画の映像と音声を読み込み中…';
  const [visualResult, audioResult] = await Promise.allSettled([
    inspectVideo(file, file.name),
    decodeVideoAudio(file),
  ]);
  const latest = store.get(id);
  const visualCurrent = visualVersion === imageUploadVersion && latest.visual === previous.visual;
  const audioCurrent = soundVersion === audioUploadVersion && latest.audio === previous.audio;
  if (!visualCurrent && !audioCurrent) return;
  const visual = visualCurrent && visualResult.status === 'fulfilled';
  const audio = audioCurrent && audioResult.status === 'fulfilled';
  const messages: string[] = [];
  if (visual) messages.push('画像に登録済み');
  else if (visualCurrent && visualResult.status === 'rejected') {
    messages.push('映像：' + (visualResult.reason instanceof Error ? visualResult.reason.message : '読み込めません'));
  }
  if (audio) messages.push('音声に登録済み');
  else if (audioCurrent && audioResult.status === 'rejected') {
    messages.push('音声：' + (audioResult.reason instanceof Error ? audioResult.reason.message : '読み込めません'));
  }
  if (visual || audio) {
    if (visual && currentSlot() === id) videoFrameSelection = null;
    store.update(id, {
      ...(visual ? { visual: {
        sourceName: file.name, sourceFormat: 'video' as const, source: file,
        gaming: false, effects: defaultVisualEffectSettings(), processed: null,
      } } : {}),
      ...(audio ? { audio: {
        sourceName: file.name, sourceFormat: 'video' as const, source: file,
        distortion: 0, processed: null,
      } } : {}),
    });
    queueSave();
    if (currentSlot() === id && !editorPanel.hidden) {
      // Avoid decoding again when switching between image and audio tabs.
      if (audio && audioResult.status === 'fulfilled') {
        try {
          prepareVideoAudioPreview(id, file, audioResult.value);
        } catch {
          // Let the normal audio editor retry preview creation if needed.
          audioPreviewBlob = null;
          audioDecoded = null;
        }
      }
      render();
    } else inventory.render(currentSlot());
  }
  if (currentSlot() === id && !editorPanel.hidden) {
    feedback.textContent = messages.join(' ／ ') +
      (visual && audio ? '。画像・音声をそれぞれ切り抜けます。' : '');
  }
}
for (const input of [imageVideoInput, soundVideoInput]) {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void registerUploadedVideo(file);
  });
}

function prepareVideoAudioPreview(id: number, source: Blob, decoded: AudioBuffer): void {
  stopAudioPreview();
  ++audioDecodeToken;
  if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
  audioPreviewBlob = source;
  audioPreviewSlot = id;
  audioDecoded = decoded;
  audioPreviewUrl = URL.createObjectURL(audioBufferToWav(decoded));
  audioPreview.src = audioPreviewUrl;
  audioPreview.load();
  audioStart.value = '0';
  audioEnd.value = String(decoded.duration);
  audioRangeStatus.textContent = '動画音声：' + decoded.duration.toFixed(2) + '秒。切り抜き範囲を指定してください。';
  audioApplyButton.disabled = false;
  drawAudioWaveform();
}

async function registerVideoAudio(source: Blob, name: string): Promise<void> {
  const id = currentSlot();
  const previous = store.get(id).audio;
  if (previous && !window.confirm('このスロットの音声を動画の音声に置き換えますか？')) return;
  const token = ++audioUploadVersion;
  feedback.textContent = '動画の音声トラックを読み込み中…';
  try {
    const decoded = await decodeVideoAudio(source);
    if (token !== audioUploadVersion || store.get(id).audio !== previous) return;
    store.update(id, { audio: { sourceName: name, sourceFormat: 'video', source, distortion: 0, processed: null } });
    if (currentSlot() === id && !editorPanel.hidden) {
      prepareVideoAudioPreview(id, source, decoded);
      feedback.textContent = '動画の音声を取り込みました。';
      activateEditorTab('audio', true);
      render();
    } else inventory.render(currentSlot());
    queueSave();
  } catch (error) {
    if (token === audioUploadVersion && currentSlot() === id) feedback.textContent = error instanceof Error ? error.message : '動画音声を読み込めませんでした。';
  }
}
function useCurrentVideoAudio(): void {
  const visual = store.get(currentSlot()).visual;
  if (visual?.sourceFormat !== 'video') return;
  if (store.get(currentSlot()).audio?.source === visual.source) {
    activateEditorTab('audio', true);
    return;
  }
  void registerVideoAudio(visual.source, visual.sourceName);
}
useImageVideo.addEventListener('click', useCurrentVideoAudio);
get<HTMLButtonElement>('video-to-audio').addEventListener('click', useCurrentVideoAudio);

soundInput.addEventListener('change', async () => {
  const file = soundInput.files?.[0];
  if (!file) return;
  soundInput.value = '';
  const id = currentSlot();
  const token = ++audioUploadVersion;
  const previous = store.get(id).audio;
  feedback.textContent = '音声の形式を確認中…';
  try {
    if (file.size === 0 || file.size > MAX_AUDIO_BYTES) {
      throw new Error('音声ファイルは20MiB以下にしてください。');
    }
    const lower = file.name.toLowerCase();
    const isOgg = lower.endsWith('.ogg');
    if (!isOgg && !lower.endsWith('.mp3')) throw new Error('MP3またはOGG Vorbisを選んでください。');
    if (isOgg && !(await isOggVorbis(file))) {
      throw new Error('OGG Vorbis形式として読み取れません。');
    }
    await decodeAudio(file); // Validate duration and decodability before accepting.
    if (token !== audioUploadVersion || store.get(id).audio !== previous) return;
    store.update(id, {
      audio: {
        sourceName: file.name,
        sourceFormat: isOgg ? 'ogg' : 'mp3',
        source: file,
        distortion: 0,
        processed: isOgg ? { ogg: file } : null,
      },
    });
    if (currentSlot() === id) feedback.textContent = isOgg
      ? `Slot ${id}にOGG Vorbisを登録しました。`
      : `Slot ${id}にMP3を登録しました。「切り抜いてOGG保存」で変換してください。`;
  } catch (error) {
    if (token === audioUploadVersion && currentSlot() === id) feedback.textContent = error instanceof Error ? error.message : '音声を読み取れませんでした。';
    return;
  }
  if (currentSlot() === id && !editorPanel.hidden) {
    render();
    activateEditorTab('audio', true);
  } else inventory.render(currentSlot());
  queueSave();
});

get<HTMLButtonElement>('remove-image').addEventListener('click', () => {
  ++imageUploadVersion;
  videoFrameSelection = null;
  store.update(currentSlot(), { visual: null });
  feedback.textContent = '画像を削除しました。';
  render();
  queueSave();
});
get<HTMLButtonElement>('remove-sound').addEventListener('click', () => {
  ++audioUploadVersion;
  store.update(currentSlot(), { audio: null });
  feedback.textContent = '音声を削除しました。';
  render();
  queueSave();
});

get<HTMLButtonElement>('clear-slot').addEventListener('click', () => {
  const id = currentSlot();
  if (!window.confirm(`Slot ${id} の画像・音声・名前を削除しますか？`)) return;
  ++imageUploadVersion;
  ++audioUploadVersion;
  videoFrameSelection = null;
  store.clear(id);
  feedback.textContent = `Slot ${id}を未設定に戻しました。`;
  render();
  queueSave();
});

async function initialize(): Promise<void> {
  // Avoid overwriting saved data while the initial asynchronous read is pending.
  app!.style.pointerEvents = 'none';
  try {
    const saved = await loadSlots();
    for (const slot of saved) {
      if (Number.isInteger(slot.id) && slot.id >= 1 && slot.id <= SLOT_COUNT) {
        store.update(slot.id, { name: slot.name ?? '', visual: slot.visual ?? null, audio: slot.audio ?? null });
      }
    }
    saveState.textContent = `この端末から${saved.length}枠のデータを復元しました。`;
    saveState.dataset.status = 'saved';
  } catch (error) {
    saveState.textContent = '保存機能を利用できません。プライベートモードや容量を確認してください。' + (error instanceof Error ? ' ' + error.message : '');
    saveState.dataset.status = 'error';
  } finally {
    ready = true;
    app!.style.pointerEvents = '';
    render();
  }
}
void initialize();
