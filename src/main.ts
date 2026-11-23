import { isOggVorbis, isPng } from './assetValidation';
import { NextbotSlotStore, SLOT_COUNT, slotStatus } from './slots';
import { mountInventory } from './inventory';
import { loadSlots, saveSlots } from './persistence';
import { cropBounds, defaultImageSettings, loadPng, processPng, sampleColor } from './imageEditor';
import type { ImageEditSettings } from './imageEditor';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root missing');

app.innerHTML = `
<main>
  <header><h1>Rune's Nextbot</h1><p class="subtitle">Resource Pack Maker · TypeScript Edition</p></header>
  <section id="inventory-root" aria-label="Nextbotスロット一覧"></section>
  <p class="note inventory-help">スロットをタップすると専用編集画面が開きます。</p>
  <section class="panel" id="editor-panel" hidden><div class="editor-nav"><button id="back-list" type="button" class="secondary-button">← 一覧へ戻る</button><button id="prev-slot" type="button" class="secondary-button">← 前の枠</button><strong id="editor-heading">Slot 01</strong><button id="next-slot" type="button" class="secondary-button">次の枠 →</button></div><h2>Nextbot専用編集画面</h2>
    <p class="note">各スロットの名前・画像・音声は別々に管理されます。現在はPNG・OGGのみ登録可能です。</p>
    <div class="fields">
      <label>登録スロット（1〜99）<select id="slot"></select></label>
      <label>Nextbotの名前<input id="bot-name" maxlength="40" placeholder="例：My Nextbot"></label>
      <label>顔画像（PNG）<input id="image" type="file" accept=".png,image/png"></label>
      <label>音声（OGG Vorbis）<input id="sound" type="file" accept=".ogg,audio/ogg"></label>
    </div>
    <p id="slot-state" class="note" aria-live="polite"></p>
    <p id="image-name" class="note"></p>
    <p id="sound-name" class="note"></p>
    <div class="preview"><img id="preview" alt="Nextbot画像のプレビュー" hidden><span id="preview-label" class="note">画像未登録</span></div>
    <section id="image-editor" class="image-editor" hidden aria-label="PNG画像編集">
      <h3>画像編集（PNG）</h3><p class="note">元画像の座標で範囲指定。元画像をドラッグして切り抜き範囲を選択。クリックだけならスポイトで色を選べます。適用するまで登録画像は変更されません。</p>
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
      <p class="note" id="crop-info"></p>
      <button type="button" id="apply-image">画像編集を適用</button>
      <p id="image-edit-status" class="note" role="status"></p>
    </section>
    <div class="editor-actions"><button id="remove-image" type="button" class="secondary-button">画像だけ削除</button><button id="remove-sound" type="button" class="secondary-button">音声だけ削除</button><button id="clear-slot" type="button" class="secondary-button">このスロットを空にする</button></div>
    <p id="save-state" class="note" role="status" aria-live="polite">保存データを読み込み中…</p>
    <p id="feedback" class="status" role="status" aria-live="polite"></p>
  </section>
  <section class="panel"><h2>99枠の集計</h2>
    <p id="summary" aria-live="polite"></p>
    <p id="export-state" class="note"></p>
    <button id="download" disabled>ZIP書き出し（段階07で実装）</button>
    <p class="warning">現在は試作版です。GIF・MP3変換、複数枠ZIP、MODとの互換性確認はまだ未実装です。</p>
  </section>
  <footer>Rune's Nextbot Maker · Minecraft非公式ツール</footer>
</main>`;

function get<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
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
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    try {
      await saveSlots(snapshot);
      savedRevision = version;
      if (savedRevision === revision) saveState.textContent = 'この端末に保存済み';
    } catch (error) {
      saveState.textContent = '保存失敗：空き容量やブラウザの設定を確認してください。' + (error instanceof Error ? ' ' + error.message : '');
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
  if (!slot.visual || slot.visual.sourceFormat !== 'png') {
    imageEditorPanel.hidden = true;
    clearTimeout(previewTimer); ++previewVersion;
    activeBitmap?.close(); activeBitmap = null; bitmapSource = null;
    return;
  }
  imageEditorPanel.hidden = false;
  if (bitmapSlot === id && bitmapSource === slot.visual.source && activeBitmap) { updateCropInfo(); return; }
  activeBitmap?.close(); activeBitmap = null;
  imageEditStatus.textContent = '元画像を読み込み中…';
  try {
    const bitmap = await loadPng(slot.visual.source);
    if (token !== editToken || currentSlot() !== id) { bitmap.close(); return; }
    activeBitmap = bitmap; bitmapSlot = id; bitmapSource = slot.visual.source;
    sourceCanvas.width = bitmap.width; sourceCanvas.height = bitmap.height;
    const defaults = defaultImageSettings(bitmap.width, bitmap.height);
    for (const [key, value] of Object.entries({ 'crop-x': defaults.x, 'crop-y': defaults.y, 'crop-width': defaults.width, 'crop-height': defaults.height })) {
      get<HTMLInputElement>(key).value = String(value);
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
  button.disabled = true; imageEditStatus.textContent = 'PNGを処理中…';
  try {
    const png = await processPng(bitmap, imageSettings());
    if (id !== currentSlot() || source !== store.get(id).visual?.source) return;
    const visual = store.get(id).visual!;
    store.update(id, { visual: { ...visual, processed: { png } } });
    render(); queueSave();
    imageEditStatus.textContent = `編集済みPNGを登録しました（${png.size.toLocaleString()} bytes）。`;
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
  editorPanel.hidden = true;
  inventoryRoot.hidden = false;
  if (inventoryHelp) inventoryHelp.hidden = false;
  render();
  inventoryRoot.scrollIntoView({ block: 'start' });
}
const inventory = mountInventory(inventoryRoot, store, openEditor);
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
  imageName.textContent = `画像：${slot.visual?.sourceName ?? '未登録'}`;
  soundName.textContent = `音声：${slot.audio?.sourceName ?? '未登録'}`;
  summaryLabel.textContent = `完成 ${summary.complete}枠 ／ 設定途中 ${summary.partial}枠 ／ 未設定 ${summary.empty}枠`;
  exportState.textContent = summary.canExport
    ? '素材の書き出し条件を満たしています。ZIP生成機能は段階07で実装します。'
    : summary.partial > 0
      ? `設定途中の${summary.partial}枠を完成させるか削除すると書き出し条件を満たせます。`
      : '少なくとも1枠に画像と音声を揃えてください。';
  void renderImageEditor(slot.id);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  if (slot.visual?.processed?.png) {
    previewUrl = URL.createObjectURL(slot.visual.processed.png);
    preview.src = previewUrl;
    preview.hidden = false;
    previewLabel.textContent = '登録済み画像';
  } else {
    preview.removeAttribute('src');
    preview.hidden = true;
    previewLabel.textContent = '画像未登録';
  }
}

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

imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  const id = currentSlot();
  feedback.textContent = '画像の形式を確認中…';
  try {
    if (!file.name.toLowerCase().endsWith('.png') || !(await isPng(file))) {
      throw new Error('PNG形式として読み取れません。PNG画像を選択してください。');
    }
    store.update(id, {
      visual: {
        sourceName: file.name,
        sourceFormat: 'png',
        source: file,
        processed: { png: file },
      },
    });
    feedback.textContent = `Slot ${id}に画像を登録しました。`;
  } catch (error) {
    feedback.textContent = error instanceof Error ? error.message : '画像を読み取れませんでした。';
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
    if (!file.name.toLowerCase().endsWith('.ogg') || !(await isOggVorbis(file))) {
      throw new Error('OGG Vorbis形式として読み取れません。対応する音声を選択してください。');
    }
    store.update(id, {
      audio: {
        sourceName: file.name,
        sourceFormat: 'ogg',
        source: file,
        processed: { ogg: file },
      },
    });
    feedback.textContent = `Slot ${id}に音声を登録しました。`;
  } catch (error) {
    feedback.textContent = error instanceof Error ? error.message : '音声を読み取れませんでした。';
  }
  if (currentSlot() === id) render();
  else inventory.render(currentSlot());
  queueSave();
});

get<HTMLButtonElement>('remove-image').addEventListener('click', () => {
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
  } catch (error) {
    saveState.textContent = '保存機能を利用できません。プライベートモードや容量を確認してください。' + (error instanceof Error ? ' ' + error.message : '');
  } finally {
    ready = true;
    app!.style.pointerEvents = '';
    render();
  }
}
void initialize();
