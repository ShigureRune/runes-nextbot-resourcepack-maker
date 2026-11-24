import JSZip from 'jszip';
import { isOggVorbis, isPng } from './assetValidation.ts';
import { slotStatus } from './slots.ts';
import type { NextbotSlot } from './slots.ts';
import { normalizeVisualEffects, GAMING_OVERLAY_OPACITY } from './visualEffects.ts';
import { MAX_ARCHIVE_BYTES } from './exportArchive.ts';

/** Proposed protocol. The future Rune's Nextbot MOD must implement its JSON reader. */
export const LIGHTWEIGHT_NAMESPACE = 'runesnextbot';
export const DEFAULT_PACK_FORMAT = 34; // Minecraft Java 1.21 / 1.21.1 (resource pack format)

/** Do not export the already color-tinted animation sprite as the base texture. */
export function lightweightTexture(slot: NextbotSlot): Blob {
  const processed = slot.visual?.processed;
  if (!processed) throw new Error(`Slot ${slot.id}: 画像編集を適用してください。`);
  if (processed.basePng) return processed.basePng;
  if (!processed.animationMcmeta) return processed.png;
  throw new Error(`Slot ${slot.id}: 古いアニメーションには加工前の画像が保存されていません。「画像編集を適用」を再実行してください。`);
}

/**
 * Make an installable Java resource-pack ZIP with one un-tinted PNG per bot.
 * The custom nextbots/*.json definitions are NOT implemented by the existing
 * MOD yet; their meaning is a proposed schema for future MOD integration.
 */
export async function buildLightweightResourcePack(
  slots: readonly NextbotSlot[], packFormat = DEFAULT_PACK_FORMAT,
): Promise<Blob> {
  if (!Number.isSafeInteger(packFormat) || packFormat < 1 || packFormat > 1000) {
    throw new RangeError('pack_formatは1〜1000の整数を指定してください。');
  }
  const partial = slots.filter(slot => slotStatus(slot) === 'partial');
  if (partial.length) throw new Error('設定途中のスロットがあります：' + partial.map(s => s.id).join(', '));
  const complete = slots.filter(slot => slotStatus(slot) === 'complete');
  if (!complete.length) throw new Error('完成済みのスロットがありません。');

  const ids = new Set<number>();
  let total = 0;
  // Preflight all assets before generating a ZIP; report legacy-animation issues explicitly.
  const entries: Array<{ slot: NextbotSlot; texture: Blob; sound: Blob; filename: string }> = [];
  for (const slot of complete) {
    if (!Number.isInteger(slot.id) || slot.id < 1 || slot.id > 99 || ids.has(slot.id)) {
      throw new Error('不正または重複したスロット番号があります。');
    }
    ids.add(slot.id);
    const texture = lightweightTexture(slot);
    const sound = slot.audio!.processed!.ogg;
    if (!(await isPng(texture)) || !(await isOggVorbis(sound))) {
      throw new Error(`Slot ${slot.id}: PNGまたはOGG Vorbisの形式検証に失敗しました。`);
    }
    total += texture.size + sound.size;
    if (total > MAX_ARCHIVE_BYTES) {
      throw new Error('ZIP対象の合計容量が150MiBを超えています。枠を減らしてください。');
    }
    entries.push({ slot, texture, sound, filename: String(slot.id).padStart(2, '0') });
  }

  const zip = new JSZip();
  zip.file('pack.mcmeta', JSON.stringify({
    pack: {
      pack_format: packFormat,
      description: "Rune's Nextbot - Lightweight MOD-ready resources (MOD JSON support pending)",
    },
  }, null, 2));
  const namespace = `assets/${LIGHTWEIGHT_NAMESPACE}/`;
  const sounds: Record<string, { sounds: Array<{ name: string; stream: boolean }> }> = {};
  const manifest: Array<{ id: number; definition: string }> = [];

  for (const { slot, texture, sound, filename } of entries) {
    const textureKey = `nextbots/${filename}`;
    const soundKey = `nextbots/${filename}`;
    const definitionPath = namespace + `nextbots/${filename}.json`;
    const effects = normalizeVisualEffects(slot.visual?.effects, Boolean(slot.visual?.gaming));
    zip.file(namespace + `textures/${textureKey}.png`, texture);
    zip.file(namespace + `sounds/${soundKey}.ogg`, sound);
    sounds[soundKey] = { sounds: [{ name: `${LIGHTWEIGHT_NAMESPACE}:${soundKey}`, stream: false }] };
    zip.file(definitionPath, JSON.stringify({
      schemaVersion: 1,
      id: slot.id,
      name: slot.name.trim() || `Nextbot ${filename}`,
      texture: `${LIGHTWEIGHT_NAMESPACE}:${textureKey}`,
      sound: `${LIGHTWEIGHT_NAMESPACE}:${soundKey}`,
      effects: {
        gaming: {
          enabled: effects.gamingMode !== 'off',
          mode: effects.gamingMode,
          direction: effects.gamingDirection,
          opacity: GAMING_OVERLAY_OPACITY,
          speed: 1,
        },
        enchant: {
          enabled: effects.enchant,
          strength: effects.enchantStrength,
          renderer: 'vanilla_entity_glint',
          speedMultiplier: 1 / 3,
          directions: 2,
          maskTransparentPixels: true,
        },
      },
    }, null, 2));
    manifest.push({ id: slot.id, definition: `${LIGHTWEIGHT_NAMESPACE}:nextbots/${filename}` });
  }
  zip.file(namespace + 'sounds.json', JSON.stringify(sounds, null, 2));
  zip.file('runes-nextbot-manifest.json', JSON.stringify({
    schemaVersion: 1,
    kind: 'proposed-runesnextbot-resource-pack',
    minecraftPackFormat: packFormat,
    namespace: LIGHTWEIGHT_NAMESPACE,
    modJsonSupportImplemented: false,
    nextbots: manifest,
  }, null, 2));
  zip.file('README.txt', [
    "Rune's Nextbot Maker - Lightweight Resource Pack (proposed MOD integration)",
    'This ZIP contains a Minecraft Java resource-pack layout and a pack.mcmeta.',
    `Target resource pack format: ${packFormat}. Match it to your Minecraft Java version.`,
    'The custom nextbots/*.json effect schema is for a FUTURE MOD update.',
    'The current MOD does NOT automatically recognize these definitions.',
    'Textures are ONE un-tinted, cropped/keyed PNG each. No 24-frame gaming/enchant sprites.',
    'The enchant effect requires MOD-side alpha-masked rendering; JSON alone cannot render it.',
    'For GIF/video sources, the lightweight mode uses one processed still frame.',
    'Use the classic asset ZIP when you need the original saved animated sprite strips.',
  ].join('\n') + '\n');
  return zip.generateAsync({
    type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 },
  });
}
