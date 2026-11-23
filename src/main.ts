import { isOggVorbis, isPng } from './assetValidation';
import { NextbotSlotStore, SLOT_COUNT, slotStatus } from './slots';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root missing');

app.innerHTML = `
<main>
  <header><h1>Rune's Nextbot</h1><p class="subtitle">Resource Pack Maker · TypeScript Edition</p></header>
  <section class="panel"><h2>Nextbot素材の登録（段階01）</h2>
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
    <p><button id="clear-slot" type="button" class="secondary-button">このスロットを空にする</button></p>
    <p class="note">段階04までは編集中のデータはメモリ内のみ。ページを更新すると消えます。</p>
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
const slotSelect = get<HTMLSelectElement>('slot');
for (let id = 1; id <= SLOT_COUNT; id++) {
  slotSelect.add(new Option(`Slot ${String(id).padStart(2, '0')}`, String(id)));
}

const nameInput = get<HTMLInputElement>('bot-name');
const imageInput = get<HTMLInputElement>('image');
const soundInput = get<HTMLInputElement>('sound');
const preview = get<HTMLImageElement>('preview');
const previewLabel = get<HTMLSpanElement>('preview-label');
const imageName = get<HTMLParagraphElement>('image-name');
const soundName = get<HTMLParagraphElement>('sound-name');
const slotState = get<HTMLParagraphElement>('slot-state');
const summaryLabel = get<HTMLParagraphElement>('summary');
const exportState = get<HTMLParagraphElement>('export-state');
const feedback = get<HTMLParagraphElement>('feedback');
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

slotSelect.addEventListener('change', () => {
  feedback.textContent = '';
  render();
});

nameInput.addEventListener('input', () => {
  store.update(currentSlot(), { name: nameInput.value });
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
  render();
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
  render();
});

get<HTMLButtonElement>('clear-slot').addEventListener('click', () => {
  const id = currentSlot();
  if (!window.confirm(`Slot ${id} の画像・音声・名前を削除しますか？`)) return;
  store.clear(id);
  feedback.textContent = `Slot ${id}を未設定に戻しました。`;
  render();
});

render();
