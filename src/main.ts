import { isOggVorbis, isPng } from './assetValidation';
import { NextbotSlotStore, SLOT_COUNT, slotStatus } from './slots';
import { mountInventory } from './inventory';
import { loadSlots, saveSlots } from './persistence';
import { cropBounds, defaultImageSettings, loadPng, processPng, sampleColor } from './imageEditor';
import type { ImageEditSettings } from './imageEditor';
import { decodeAudio, encodeVorbisRange, waveformPeaks, MAX_AUDIO_BYTES, sampleRange } from './audioEditor';
import { buildAssetArchive } from './exportArchive';
import { inspectGif, processGif } from './gifEditor';
import { inspectVideo, captureVideoFrame, assertVideoInfo, isVideoFilename, frameTime } from './videoEditor';
import { MOD_DOWNLOAD_JAR_URL, verifiedJarUrl, jarFilename } from './modRelease';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root missing');

app.innerHTML = `
<main>
  <header><h1>Rune's Nextbot Maker</h1><p class="subtitle">RESOURCE PACK WORKSHOP · NEXTBOT INVENTORY</p><a class="mod-shortcut" href="#mod-download">MODの入手案内 ↓</a></header>
  <section id="inventory-root" aria-label="Nextbotスロット一覧"></section>
  <p class="note inventory-help">スロットをタップすると専用編集画面が開きます。</p>
  <section class="panel" id="editor-panel" hidden><div class="editor-nav"><button id="back-list" type="button" class="secondary-button">← 一覧へ戻る</button><button id="prev-slot" type="button" class="secondary-button">← 前の枠</button><strong id="editor-heading">Slot 01</strong><button id="next-slot" type="button" class="secondary-button">次の枠 →</button></div><h2>スロットの編集</h2>
    <section class="setup-block" aria-label="基本設定と素材登録"><h3>01 · 基本設定と素材登録</h3>
    <p class="note">素材を選んで登録。GIF・MP3・動画は編集・変換後に完成扱いになります。</p>
    <div class="fields">
      <label>登録スロット（1〜99）<select id="slot"></select></label>
      <label>Nextbotの名前<input id="bot-name" maxlength="40" placeholder="例：My Nextbot"></label>
      <label>顔画像・動画（PNG / GIF / MP4 / WebM / MOV）<input id="image" type="file" accept=".png,.gif,.mp4,.m4v,.webm,.mov,image/png,image/gif,video/mp4,video/webm,video/quicktime"></label>
      <label>音声（MP3 / OGG Vorbis）<input id="sound" type="file" accept=".mp3,.ogg,audio/mpeg,audio/ogg"></label>
    </div>
    <p id="slot-state" class="note" aria-live="polite"></p>
    <p id="image-name" class="note"></p>
    <p id="sound-name" class="note"></p></section>
    <div class="preview"><img id="preview" alt="Nextbot画像のプレビュー" hidden><span id="preview-label" class="note">画像未登録</span></div>
    <section id="image-editor" class="image-editor" hidden aria-label="画像・動画フレーム編集">
      <h3>02 · 画像編集（PNG / GIF / 動画フレーム）</h3><p class="note">元画像の座標で範囲指定。元画像をドラッグして切り抜き範囲を選択。クリックだけならスポイトで色を選べます。適用するまで登録画像は変更されません。</p>
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
      <div id="gif-range" hidden>
        <p class="note" id="gif-info">GIFフレームを読み込み中…</p>
        <div class="fields">
          <label>GIF開始フレーム（1から）<input id="gif-start" type="number" min="1" step="1" value="1"></label>
          <label>GIF終了フレーム（含む）<input id="gif-end" type="number" min="1" step="1" value="1"></label>
        </div>
        <p class="note">GIFの全フレームに同じ切り抜き・クロマキーを適用します。最大24フレーム。再生速度は50ms単位に変換されます。</p>
      </div>
      <p class="note" id="crop-info"></p>
      <button type="button" id="apply-image">画像編集を適用</button>
      <p id="image-edit-status" class="note" role="status"></p>
    </section>
    <section id="video-editor" class="image-editor" hidden aria-label="動画プレビューと静止画抽出">
      <h3>03 · 動画から静止画</h3>
      <p class="note">動画を再生して位置を選び、フレームを取り込んだ後、下の画像編集で切り抜き・背景透過を適用できます。元の動画は保持します。</p>
      <video id="video-preview" class="video-preview" controls playsinline preload="metadata"></video>
      <label>静止画を取り出す秒数<input id="video-time" type="number" min="0" step="0.01" value="0"></label>
      <input id="video-seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="動画の再生位置">
      <button id="capture-video" type="button">このフレームを画像編集へ</button>
      <p id="video-status" class="note" role="status" aria-live="polite"></p>
      <p class="note">上限32MiB・120秒・約207万画素。MP4/WebM/MOVのコーデック対応はブラウザ依存です。動画から音声・アニメーションを抽出する機能は次の段階。</p>
    </section>
    <section id="audio-editor" class="image-editor" hidden aria-label="音声編集">
      <h3>04 · 音声編集（MP3 / OGG Vorbis）</h3>
      <p class="note">音声を聴きながら開始・終了位置を指定し、「切り抜いてOGG保存」で本物のOGG Vorbisに変換します（元ファイルは保持）。音声は20MiB・120秒以内。</p>
      <audio id="audio-preview" controls preload="metadata" style="width:100%"></audio>
      <canvas id="audio-waveform" width="640" height="100" class="audio-waveform" aria-label="音声波形と切り抜き範囲"></canvas>
      <div class="fields">
        <label>開始位置（秒）<input id="audio-start" type="number" min="0" step="0.01" value="0"></label>
        <label>終了位置（秒）<input id="audio-end" type="number" min="0" step="0.01" value="0"></label>
      </div>
      <p id="audio-range-status" class="note" role="status"></p>
      <div class="editor-actions">
        <button id="play-audio-range" type="button" class="secondary-button">指定範囲を試聴</button>
        <button id="apply-audio" type="button">切り抜いてOGG保存</button>
      </div>
      <p class="note">MP3は変換完了まで未完成扱いです。ブラウザが元音声をデコードできない場合、編集はできません。</p>
    </section>
    <h3 class="danger-heading">素材の削除</h3><div class="editor-actions"><button id="remove-image" type="button" class="secondary-button">画像だけ削除</button><button id="remove-sound" type="button" class="secondary-button">音声だけ削除</button><button id="clear-slot" type="button" class="secondary-button">このスロットを空にする</button></div>
    <p id="save-state" class="note" role="status" aria-live="polite">保存データを読み込み中…</p>
    <p id="feedback" class="status" role="status" aria-live="polite"></p>
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
const audioEditor = get<HTMLElement>('audio-editor');
const audioPreview = get<HTMLAudioElement>('audio-preview');
const audioStart = get<HTMLInputElement>('audio-start');
const audioEnd = get<HTMLInputElement>('audio-end');
const audioRangeStatus = get<HTMLElement>('audio-range-status');
const audioWaveform = get<HTMLCanvasElement>('audio-waveform');
const audioApplyButton = get<HTMLButtonElement>('apply-audio');
let audioPreviewUrl: string | null = null;
let audioPreviewBlob: Blob | null = null;
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
  const blob = slot.audio?.processed?.ogg ?? slot.audio?.source ?? null;
  audioEditor.hidden = !blob;
  if (blob === audioPreviewBlob) return;
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
  audioPreviewUrl = URL.createObjectURL(blob);
  audioPreview.src = audioPreviewUrl;
  audioPreview.load();
  void decodeAudio(blob).then(buffer => {
    if (token !== audioDecodeToken || audioPreviewBlob !== blob) return;
    audioDecoded = buffer;
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
  const selected = audio?.processed?.ogg ?? audio?.source;
  if (!audio || !selected || audioApplyButton.disabled) return;
  audioApplyButton.disabled = true;
  stopAudioPreview();
  try {
    const decoded = audioDecoded && selected === audioPreviewBlob ? audioDecoded : await decodeAudio(selected);
    const start = Number(audioStart.value), requestedEnd = Number(audioEnd.value);
    // Container metadata may differ from decoded PCM duration by a few milliseconds.
    const end = requestedEnd > decoded.duration && requestedEnd - decoded.duration < 0.1
      ? decoded.duration : requestedEnd;
    sampleRange({ start, end }, decoded.duration, decoded.sampleRate);
    audioRangeStatus.textContent = '本物のOGG Vorbisに変換中…';
    const ogg = await encodeVorbisRange(decoded, { start, end }, fraction => {
      if (currentSlot() === id) audioRangeStatus.textContent =
        'OGG Vorbisに変換中… ' + Math.round(fraction * 100) + '%';
    });
    if (store.get(id).audio !== audio) return; // Source was removed or replaced while encoding.
    store.update(id, { audio: { ...audio, processed: { ogg } } });
    if (currentSlot() === id) {
      render();
      audioRangeStatus.textContent = 'OGG Vorbisを保存しました（' + ogg.size.toLocaleString() + ' bytes）。';
    }
    queueSave();
  } catch (error) {
    if (currentSlot() === id) audioRangeStatus.textContent =
      '変換失敗：' + (error instanceof Error ? error.message : '再度お試しください。') + ' 元のデータは保持しました。';
  } finally {
    audioApplyButton.disabled = false;
  }
});
window.addEventListener('pagehide', () => {
  stopAudioPreview();
  ++audioDecodeToken;
  if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
});

interface VideoFrameSelection { slotId: number; source: Blob; png: Blob }
let videoFrameSelection: VideoFrameSelection | null = null;
const videoEditor = get<HTMLElement>('video-editor');
const videoPreview = get<HTMLVideoElement>('video-preview');
const videoTimeInput = get<HTMLInputElement>('video-time');
const videoSeekInput = get<HTMLInputElement>('video-seek');
const videoCaptureButton = get<HTMLButtonElement>('capture-video');
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
  videoCaptureButton.disabled = true;
  videoTimeInput.value = '0';
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
    videoCaptureButton.disabled = false;
    videoStatus.textContent = `動画：${info.width}×${info.height}px・${info.duration.toFixed(2)}秒。再生位置を指定してください。`;
  } catch (error) {
    videoCaptureButton.disabled = true;
    videoStatus.textContent = error instanceof Error ? error.message : '動画を開けません。';
  }
});
videoPreview.addEventListener('error', () => {
  if (videoPreviewBlob) {
    videoCaptureButton.disabled = true;
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
videoCaptureButton.addEventListener('click', async () => {
  const id = currentSlot();
  const visual = store.get(id).visual;
  if (visual?.sourceFormat !== 'video' || videoCaptureButton.disabled || videoPreviewBlob !== visual.source) return;
  const version = videoVersion;
  const t = Number(videoTimeInput.value);
  videoCaptureButton.disabled = true;
  videoStatus.textContent = '指定フレームをPNGに変換中…';
  try {
    const png = await captureVideoFrame(videoPreview, t);
    if (version !== videoVersion || store.get(id).visual !== visual || currentSlot() !== id) return;
    videoFrameSelection = { slotId: id, source: visual.source, png };
    await renderImageEditor(id);
    videoStatus.textContent = `${t.toFixed(2)}秒のフレームを取得しました。下の画像編集を適用して保存してください。`;
    imageEditorPanel.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    if (version === videoVersion) videoStatus.textContent = '取得に失敗：' +
      (error instanceof Error ? error.message : '動画フレームを確認してください。');
  } finally {
    if (version === videoVersion) videoCaptureButton.disabled = false;
  }
});
window.addEventListener('pagehide', releaseVideoPreview);

const preview = get<HTMLImageElement>('preview');
const imageEditorPanel = get<HTMLElement>('image-editor');
const sourceCanvas = get<HTMLCanvasElement>('source-canvas');
const processedPreview = get<HTMLCanvasElement>('processed-preview');
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let previewVersion = 0;
const cropInfo = get<HTMLElement>('crop-info');
const imageEditStatus = get<HTMLElement>('image-edit-status');
const cropFields = ['crop-x','crop-y','crop-width','crop-height'] as const;
let activeBitmap: ImageBitmap | null = null;
let bitmapSlot = 0;
let bitmapSource: Blob | null = null;
let editToken = 0;
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
  previewTimer = setTimeout(async () => {
    try {
      const png = await processPng(bitmap, imageSettings());
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
  const slot = store.get(id);
  const editSource = slot.visual?.sourceFormat === 'video'
    ? (videoFrameSelection?.slotId === id && videoFrameSelection.source === slot.visual.source ? videoFrameSelection.png : null)
    : slot.visual?.source;
  if (!slot.visual || !editSource) {
    imageEditorPanel.hidden = true;
    get<HTMLElement>('gif-range').hidden = true;
    clearTimeout(previewTimer); ++previewVersion;
    activeBitmap?.close(); activeBitmap = null; bitmapSource = null;
    return;
  }
  imageEditorPanel.hidden = false;
  get<HTMLElement>('gif-range').hidden = slot.visual.sourceFormat !== 'gif';
  if (bitmapSlot === id && bitmapSource === editSource && activeBitmap) { updateCropInfo(); return; }
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
  button.disabled = true; imageEditStatus.textContent = '画像を処理中…';
  try {
    const visual = store.get(id).visual!;
    const unchanged = () => id === currentSlot() && store.get(id).visual === visual &&
      (visual.sourceFormat === 'video' ? videoFrameSelection?.png === source : visual.source === source);
    if (visual.sourceFormat === 'gif') {
      const result = await processGif(visual.source, imageSettings(), {
        first: Number(get<HTMLInputElement>('gif-start').value),
        last: Number(get<HTMLInputElement>('gif-end').value),
      }, fraction => {
        if (currentSlot() === id) imageEditStatus.textContent = 'GIF変換中…' + Math.round(fraction * 100) + '%';
      });
      if (!unchanged()) return;
      store.update(id, { visual: { ...visual, processed: {
        png: result.png, previewPng: result.previewPng, animationMcmeta: result.animationMcmeta,
      } } });
      render(); queueSave();
      imageEditStatus.textContent = `GIF ${result.frameCount}フレームのアニメーションPNGを登録しました。`;
    } else {
      const png = await processPng(bitmap, imageSettings());
      if (!unchanged()) return;
      store.update(id, { visual: { ...visual, processed: { png } } });
      render(); queueSave();
      imageEditStatus.textContent = `編集済みPNGを登録しました（${png.size.toLocaleString()} bytes）。`;
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
function openEditor(id: number): void {
  slotSelect.value = String(id);
  editorPanel.hidden = false;
  inventoryRoot.hidden = true;
  if (inventoryHelp) inventoryHelp.hidden = true;
  feedback.textContent = '';
  render();
  editorPanel.scrollIntoView({ block: 'start' });
}
function showInventory(): void {
  stopAudioPreview();
  videoPreview.pause();
  editorPanel.hidden = true;
  inventoryRoot.hidden = false;
  if (inventoryHelp) inventoryHelp.hidden = false;
  render();
  inventoryRoot.scrollIntoView({ block: 'start' });
}
const inventory = mountInventory(inventoryRoot, store, openEditor, () => {
  // The store transfer modifies one or two slots; persist the whole snapshot atomically.
  ++imageUploadVersion;
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
  editorHeading.textContent = `Slot ${String(slot.id).padStart(2, '0')}`;
  prevButton.disabled = slot.id === 1;
  nextButton.disabled = slot.id === SLOT_COUNT;
  nameInput.value = slot.name;
  imageInput.value = '';
  soundInput.value = '';
  slotState.textContent = `Slot ${String(slot.id).padStart(2, '0')}：${statusLabels[state]}`;
  slotState.dataset.state = state;
  imageName.textContent = `画像：${slot.visual?.sourceName ?? '未登録'}${slot.visual?.sourceFormat === 'video' ? (slot.visual.processed ? '（静止画処理済み）' : '（フレーム編集待ち）') : ''}`;
  soundName.textContent = `音声：${slot.audio?.sourceName ?? '未登録'}${slot.audio?.sourceFormat === 'mp3' ? (slot.audio.processed ? '（OGG変換済み）' : '（未変換）') : ''}`;
  summaryLabel.textContent = `完成 ${summary.complete}枠 ／ 設定途中 ${summary.partial}枠 ／ 未設定 ${summary.empty}枠`;
  get<HTMLButtonElement>('download').disabled = !summary.canExport;
  exportState.textContent = summary.canExport
    ? '完成枠をまとめて素材ZIPに保存できます（MOD用の完成リソースパックではありません）。'
    : summary.partial > 0
      ? `設定途中の${summary.partial}枠を完成させるか削除すると書き出し条件を満たせます。`
      : '少なくとも1枠に画像と音声を揃えてください。';
  void renderImageEditor(slot.id);
  renderAudioEditor(slot.id);
  renderVideoEditor(slot.id);
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
  render();
});

nameInput.addEventListener('input', () => {
  store.update(currentSlot(), { name: nameInput.value });
  inventory.render(currentSlot());
  queueSave();
});

let imageUploadVersion = 0;
imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  const id = currentSlot();
  const version = ++imageUploadVersion;
  const previous = store.get(id).visual;
  feedback.textContent = '画像・動画を確認中…';
  try {
    if (isVideoFilename(file.name)) {
      const info = await inspectVideo(file, file.name);
      if (version !== imageUploadVersion || store.get(id).visual !== previous) return;
      videoFrameSelection = null;
      store.update(id, { visual: {
        sourceName: file.name, sourceFormat: 'video', source: file, processed: null,
      } });
      if (currentSlot() === id) feedback.textContent =
        `Slot ${id}に動画（${info.duration.toFixed(1)}秒）を登録しました。好きなフレームを取り込んでください。`;
    } else if (file.name.toLowerCase().endsWith('.gif')) {
      const info = await inspectGif(file);
      if (version !== imageUploadVersion || store.get(id).visual !== previous) return;
      videoFrameSelection = null;
      store.update(id, { visual: {
        sourceName: file.name, sourceFormat: 'gif', source: file, processed: null,
      } });
      if (currentSlot() === id) feedback.textContent = `Slot ${id}にGIF（${info.count}フレーム）を登録しました。`;
    } else {
      if (!file.name.toLowerCase().endsWith('.png') || !(await isPng(file))) {
        throw new Error('PNG・GIF・MP4・WebM・MOVを選んでください。');
      }
      if (file.size > 16 * 1024 * 1024) throw new Error('PNGは16MiB以下にしてください。');
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 8_000_000) {
          throw new Error('PNGが大きすぎます。各辺4096px以下・合計800万画素以下にしてください。');
        }
      } finally { bitmap.close(); }
      if (version !== imageUploadVersion || store.get(id).visual !== previous) return;
      videoFrameSelection = null;
      store.update(id, { visual: {
        sourceName: file.name, sourceFormat: 'png', source: file, processed: { png: file },
      } });
      if (currentSlot() === id) feedback.textContent = `Slot ${id}にPNGを登録しました。`;
    }
  } catch (error) {
    if (version === imageUploadVersion && currentSlot() === id) feedback.textContent =
      error instanceof Error ? error.message : '画像・動画を読み取れませんでした。';
    return;
  }
  if (currentSlot() === id) render();
  else inventory.render(currentSlot());
  queueSave();
});

soundInput.addEventListener('change', async () => {
  const file = soundInput.files?.[0];
  if (!file) return;
  const id = currentSlot();
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
    if (!isOgg) await decodeAudio(file); // Verify MP3 before accepting it as an unfinished slot.
    store.update(id, {
      audio: {
        sourceName: file.name,
        sourceFormat: isOgg ? 'ogg' : 'mp3',
        source: file,
        processed: isOgg ? { ogg: file } : null,
      },
    });
    feedback.textContent = isOgg
      ? `Slot ${id}にOGG Vorbisを登録しました。`
      : `Slot ${id}にMP3を登録しました。「切り抜いてOGG保存」で変換してください。`;
  } catch (error) {
    feedback.textContent = error instanceof Error ? error.message : '音声を読み取れませんでした。';
  }
  if (currentSlot() === id) render();
  else inventory.render(currentSlot());
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
  store.update(currentSlot(), { audio: null });
  feedback.textContent = '音声を削除しました。';
  render();
  queueSave();
});

get<HTMLButtonElement>('clear-slot').addEventListener('click', () => {
  const id = currentSlot();
  if (!window.confirm(`Slot ${id} の画像・音声・名前を削除しますか？`)) return;
  ++imageUploadVersion;
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
