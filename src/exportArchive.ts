import JSZip from 'jszip';
import { isOggVorbis, isPng } from './assetValidation.ts';
import { slotStatus } from './slots.ts';
import { normalizeGifSpeed, retimeAnimationMcmeta } from './gifPlayback.ts';
import type { NextbotSlot } from './slots.ts';

export const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;
const RESOURCE_PACK_FORMAT = [97, 1] as const;

/** Export a Minecraft 26.3 resource pack for nextbot-chaos. */
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
  const soundEntries: Record<string, { replace: boolean; sounds: Array<{ name: string; stream: boolean }> }> = {};
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

    const suffix = String(slot.id).padStart(2, '0');
    const texture = `assets/nextbotchaos/textures/entity/nextbot_${suffix}.png`;
    const soundName = `nextbot_chase_${suffix}`;
    const sound = `assets/nextbotchaos/sounds/${soundName}.ogg`;
    zip.file(texture, visual.png);
    zip.file(sound, audio.ogg);
    soundEntries[soundName] = { replace: true, sounds: [{ name: `nextbotchaos:${soundName}`, stream: false }] };

    if (visual.animationMcmeta) {
      zip.file(texture + '.mcmeta',
        retimeAnimationMcmeta(visual.animationMcmeta, normalizeGifSpeed(slot.visual?.animationSpeed)));
    }
  }

  // Keep the Mod's original sound ID usable with the first configured slot.
  const first = String(completed[0].id).padStart(2, '0');
  soundEntries.nextbot_chase = {
    replace: true,
    sounds: [{ name: `nextbotchaos:nextbot_chase_${first}`, stream: false }],
  };

  zip.file('pack.mcmeta', JSON.stringify({
    pack: {
      description: "Rune's Nextbot custom resource pack",
      min_format: RESOURCE_PACK_FORMAT,
      max_format: RESOURCE_PACK_FORMAT,
    },
  }, null, 2));
  zip.file('assets/nextbotchaos/sounds.json', JSON.stringify(soundEntries, null, 2));
  zip.file('manifest.json', JSON.stringify({
    archiveType: 'minecraft-resource-pack',
    version: 2,
    mod: 'nextbotchaos',
    resourcePackFormat: RESOURCE_PACK_FORMAT,
    slots: completed.map(slot => ({
      id: slot.id,
      name: slot.name,
      texture: `assets/nextbotchaos/textures/entity/nextbot_${String(slot.id).padStart(2, '0')}.png`,
      sound: `assets/nextbotchaos/sounds/nextbot_chase_${String(slot.id).padStart(2, '0')}.ogg`,
    })),
  }, null, 2));
  zip.file('README.txt',
    "Rune's Nextbot Maker - Minecraft 26.3 resource pack\n" +
    'Install this ZIP in the Minecraft resourcepacks folder.\n' +
    'The Mod must be installed separately.\n');

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
}
