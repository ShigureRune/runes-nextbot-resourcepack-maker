import JSZip from 'jszip';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root missing');

app.innerHTML = `
<main>
  <header><h1>Rune's Nextbot</h1><p class="subtitle">Resource Pack Maker · TypeScript Edition</p></header>
  <section class="panel"><h2>オリジナルNextbotを作成</h2>
    <div class="fields">
      <label>Nextbotの名前<input id="bot-name" maxlength="40" placeholder="例：My Nextbot" value="My Nextbot"></label>
      <label>登録スロット（1〜100）<select id="slot"></select></label>
      <label>顔画像（PNG）<input id="image" type="file" accept=".png,image/png"></label>
      <label>音声（OGG Vorbis・任意）<input id="sound" type="file" accept=".ogg,audio/ogg"></label>
    </div>
    <p class="note">すべてブラウザ内で処理します。ファイルはサーバーへ送信されません。</p>
    <div class="preview"><img id="preview" alt="選択したNextbot画像のプレビュー" hidden><span id="preview-label" class="note">画像を選択するとプレビューが表示されます。</span></div>
  </section>
  <section class="panel"><h2>リソースパックを生成</h2>
    <p class="warning">現在は試作版です。PNG・OGGのパック化に対応。GIF・MP3の変換は未実装です。MOD側の読み込みパスはまだ未確定のため、生成ZIPは連携仕様確定後に調整が必要です。</p>
    <button id="download">ZIPを生成して保存</button>
    <p id="status" class="status" role="status" aria-live="polite"></p>
  </section>
  <footer>Rune's Nextbot Maker · Minecraft非公式ツール</footer>
</main>`;

const get = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
};
const slot = get<HTMLSelectElement>('slot');
for (let i = 1; i <= 100; i++) slot.add(new Option(`Slot ${String(i).padStart(3, '0')}`, String(i)));
const imageInput = get<HTMLInputElement>('image');
const soundInput = get<HTMLInputElement>('sound');
const preview = get<HTMLImageElement>('preview');
const previewLabel = get<HTMLSpanElement>('preview-label');
const status = get<HTMLParagraphElement>('status');
const download = get<HTMLButtonElement>('download');
let previewUrl: string | null = null;
imageInput.addEventListener('change', () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  const file = imageInput.files?.[0];
  preview.hidden = !file;
  previewLabel.textContent = file ? file.name : '画像を選択するとプレビューが表示されます。';
  if (file) { previewUrl = URL.createObjectURL(file); preview.src = previewUrl; }
});

function validExtension(file: File, ext: string): boolean { return file.name.toLowerCase().endsWith(ext); }
function packDescription(name: string): string { return `Rune's Nextbot: ${name}`; }

// Temporary resource paths: update alongside the Fabric mod's agreed resource identifiers.
download.addEventListener('click', async () => {
  const image = imageInput.files?.[0];
  const sound = soundInput.files?.[0];
  const name = get<HTMLInputElement>('bot-name').value.trim();
  if (!name) { status.textContent = '名前を入力してください。'; return; }
  if (!image || !validExtension(image, '.png')) { status.textContent = 'PNG画像を選択してください。'; return; }
  if (sound && !validExtension(sound, '.ogg')) { status.textContent = '音声はOGGファイルを選択してください。'; return; }
  download.disabled = true;
  status.textContent = 'ZIPを生成しています…';
  try {
    const id = String(slot.value).padStart(3, '0');
    const zip = new JSZip();
    // pack_format 15 is an illustrative placeholder; the target Minecraft version must be agreed.
    zip.file('pack.mcmeta', JSON.stringify({pack:{pack_format:15,description:packDescription(name)}},null,2));
    zip.file(`assets/runes_nextbot/textures/nextbots/slot_${id}.png`, image);
    if (sound) {
      zip.file(`assets/runes_nextbot/sounds/nextbots/slot_${id}.ogg`, sound);
      zip.file('assets/runes_nextbot/sounds.json', JSON.stringify({[`nextbots.slot_${id}`]:{sounds:[`nextbots/slot_${id}`]}},null,2));
    }
    zip.file('nextbot-info.json', JSON.stringify({name,slot:Number(slot.value),image:image.name,sound:sound?.name??null,warning:'Provisional paths; requires matching Rune\'s Nextbot mod implementation.'},null,2));
    const blob = await zip.generateAsync({type:'blob'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `runes-nextbot-slot-${id}.zip`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = `Slot ${id} のZIPを生成しました。MOD対応はまだ未確認です。`;
  } catch (error) {
    status.textContent = `生成に失敗しました: ${error instanceof Error ? error.message : String(error)}`;
  } finally { download.disabled = false; }
});
