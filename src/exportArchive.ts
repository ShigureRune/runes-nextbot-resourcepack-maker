import JSZip from 'jszip';
import { isOggVorbis, isPng } from './assetValidation.ts';
import { slotStatus } from './slots.ts';
import { normalizeGifSpeed, retimeAnimationMcmeta } from './gifPlayback.ts';
import type { NextbotSlot } from './slots.ts';

export const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;

/**
 * Stage 07 produces a portable SOURCE-ASSET ARCHIVE, NOT an installed
 * Minecraft resource pack. The MOD's namespace, pack_format and file
 * naming rules have not yet been verified. No pack.mcmeta is invented.
 */
export async function buildAssetArchive(slots: readonly NextbotSlot[]): Promise<Blob> {
  const partial = slots.filter(slot => slotStatus(slot) === 'partial').map(slot => slot.id);
  if (partial.length) {
    throw new Error('設定途中のスロットがあるためZIPを出力できません：' + partial.join(', '));
  }
  const completed = slots.filter(slot => slotStatus(slot) === 'complete');
  if (!completed.length) throw new Error('完成済みのスロットがありません。');
  const total = completed.reduce((n, slot) =>
    n + (slot.visual?.processed?.png.size ?? 0) + (slot.audio?.processed?.ogg.size ?? 0), 0);
  if (total > MAX_ARCHIVE_BYTES) {
    throw new Error('ZIP対象の合計容量が150MiBを超えています。枠を減らしてください。');
  }
  const zip = new JSZip();
  const manifest: { archiveType: string; version: number; resourcePackCompatible: false;
    slots: Array<{ id: number; name: string; texture: string; sound: string; animation?: string; animationSpeed?: number }> } = {
    archiveType: 'runes-nextbot-assets',
    version: 1,
    resourcePackCompatible: false,
    slots: [],
  };
  const ids = new Set<number>();
  for (const slot of completed) {
    if (!Number.isInteger(slot.id) || slot.id < 1 || slot.id > 99 || ids.has(slot.id)) {
      throw new Error('不正または重複したスロット番号があります。');
    }
    ids.add(slot.id);
    const visual = slot.visual!.processed!;
    const audio = slot.audio!.processed!;
    if (!(await isPng(visual.png)) || !(await isOggVorbis(audio.ogg))) {
      throw new Error('Slot ' + slot.id + ': PNGまたはOGG Vorbisの形式検証に失敗しました。');
    }
    const dir = 'slots/slot_' + String(slot.id).padStart(2, '0') + '/';
    const texture = dir + 'face.png', sound = dir + 'sound.ogg';
    zip.file(texture, visual.png);
    zip.file(sound, audio.ogg);
    const entry: { id: number; name: string; texture: string; sound: string; animation?: string; animationSpeed?: number } = {
      id: slot.id, name: slot.name, texture, sound,
    };
    if (visual.animationMcmeta) {
      // Export the same integer game-tick timings the editor preview uses.
      // This archive is not yet a MOD-ready resource pack.
      const animation = dir + 'face.png.mcmeta';
      const animationSpeed = normalizeGifSpeed(slot.visual?.animationSpeed);
      zip.file(animation, retimeAnimationMcmeta(visual.animationMcmeta, animationSpeed));
      entry.animation = animation;
      entry.animationSpeed = animationSpeed;
    }
    manifest.slots.push(entry);
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('README.txt',
    "Rune's Nextbot Maker - source asset archive\n" +
    'This ZIP is NOT a Minecraft resource pack and has not been validated against the MOD.\n' +
    'No pack.mcmeta is included. Do not install this ZIP as a resource pack.\n' +
    'Once the MOD format is verified, an exporter can map these assets into the correct paths.\n');
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
}
