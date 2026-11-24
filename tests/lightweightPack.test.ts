import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { buildLightweightResourcePack, DEFAULT_PACK_FORMAT, lightweightTexture } from '../src/lightweightPack.ts';
import type { NextbotSlot } from '../src/slots.ts';

function image(tag: number): Blob {
  const bytes = new Uint8Array(24);
  bytes.set([137,80,78,71,13,10,26,10], 0);
  bytes.set([73,72,68,82], 12);
  bytes[23] = tag;
  return new Blob([bytes], { type: 'image/png' });
}
function sound(): Blob {
  const bytes = new Uint8Array(44);
  bytes.set([79,103,103,83], 0);
  bytes.set([1,118,111,114,98,105,115], 29);
  return new Blob([bytes], { type: 'audio/ogg' });
}
function complete(id: number): NextbotSlot {
  return {
    id, name: `Bot ${id}`,
    visual: {
      sourceName: 'original.png', sourceFormat: 'png', source: image(1),
      effects: { gamingMode: 'diagonal', gamingDirection: 'br-tl', enchant: true, enchantStrength: 35 },
      processed: {
        png: image(240), basePng: image(11), previewPng: image(240),
        animationMcmeta: JSON.stringify({ animation: { frametime: 1, frames: [
          { index: 0, time: 3 }, { index: 1, time: 3 },
        ] } }),
      },
    },
    audio: { sourceName: 'sound.ogg', sourceFormat: 'ogg', source: sound(), processed: { ogg: sound() } },
  };
}
test('lightweight pack contains valid Minecraft folder layout and editable JSON definitions', async () => {
  const zip = await JSZip.loadAsync(await (await buildLightweightResourcePack([complete(1), complete(99)])).arrayBuffer());
  const paths = Object.keys(zip.files);
  assert.ok(paths.includes('pack.mcmeta'));
  assert.ok(paths.includes('assets/runesnextbot/textures/nextbots/01.png'));
  assert.ok(paths.includes('assets/runesnextbot/textures/nextbots/99.png'));
  assert.ok(paths.includes('assets/runesnextbot/sounds/nextbots/01.ogg'));
  assert.ok(paths.includes('assets/runesnextbot/sounds.json'));
  assert.ok(paths.includes('assets/runesnextbot/nextbots/01.json'));
  assert.ok(paths.includes('assets/runesnextbot/nextbots/99.json'));
  assert.equal(paths.filter(p => p.endsWith('png.mcmeta')).length, 0);
  const mcmeta = JSON.parse(await zip.file('pack.mcmeta')!.async('string'));
  assert.equal(DEFAULT_PACK_FORMAT, 34);
  assert.equal(mcmeta.pack.pack_format, 34);

  const config = JSON.parse(await zip.file('assets/runesnextbot/nextbots/01.json')!.async('string'));
  assert.equal(config.id, 1);
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.texture, 'runesnextbot:nextbots/01');
  assert.equal(config.sound, 'runesnextbot:nextbots/01');
  assert.deepEqual(config.effects.gaming, {
    enabled: true, mode: 'diagonal', direction: 'br-tl', opacity: 0.45, speed: 1,
  });
  assert.deepEqual(config.effects.enchant, {
    enabled: true, strength: 35, renderer: 'vanilla_entity_glint',
    speedMultiplier: 1/3, directions: 2, maskTransparentPixels: true,
  });
  const sounds = JSON.parse(await zip.file('assets/runesnextbot/sounds.json')!.async('string'));
  assert.deepEqual(sounds['nextbots/01'], {
    sounds: [{ name: 'runesnextbot:nextbots/01', stream: false }],
  });
  const manifest = JSON.parse(await zip.file('runes-nextbot-manifest.json')!.async('string'));
  assert.equal(manifest.modJsonSupportImplemented, false);
  assert.equal(manifest.nextbots.length, 2);
  assert.match(await zip.file('README.txt')!.async('string'), /FUTURE MOD update/);
});

test('lightweight mode uses the untinted base texture, not the baked 24-frame sprite', async () => {
  const slot = complete(1);
  const zip = await JSZip.loadAsync(await (await buildLightweightResourcePack([slot])).arrayBuffer());
  const actual = await zip.file('assets/runesnextbot/textures/nextbots/01.png')!.async('uint8array');
  assert.deepEqual([...actual], [...new Uint8Array(await slot.visual!.processed!.basePng!.arrayBuffer())]);
  assert.notDeepEqual([...actual], [...new Uint8Array(await slot.visual!.processed!.png.arrayBuffer())]);
});

test('unanimated old slots remain exportable without basePng', async () => {
  const slot = complete(1);
  const updated: NextbotSlot = { ...slot, visual: {
    ...slot.visual!, effects: undefined, processed: { png: image(9) },
  } };
  const zip = await JSZip.loadAsync(await (await buildLightweightResourcePack([updated], 15)).arrayBuffer());
  assert.equal(JSON.parse(await zip.file('pack.mcmeta')!.async('string')).pack.pack_format, 15);
  const effect = JSON.parse(await zip.file('assets/runesnextbot/nextbots/01.json')!.async('string'));
  assert.equal(effect.effects.gaming.enabled, false);
  assert.equal(effect.effects.gaming.mode, 'off');
  assert.equal(effect.effects.enchant.enabled, false);
});

test('old animated slots require re-apply rather than exporting a tinted sprite as a texture', async () => {
  const slot = complete(1);
  const old: NextbotSlot = { ...slot, visual: { ...slot.visual!,
    processed: { png: image(240), animationMcmeta: slot.visual!.processed!.animationMcmeta },
  } };
  assert.throws(() => lightweightTexture(old), /再実行/);
  await assert.rejects(buildLightweightResourcePack([old]), /再実行/);
});

test('reject incomplete, duplicated, malformed resources, and invalid pack formats', async () => {
  const partial = { ...complete(1), audio: null };
  await assert.rejects(buildLightweightResourcePack([partial]), /設定途中/);
  await assert.rejects(buildLightweightResourcePack([]), /完成済み/);
  await assert.rejects(buildLightweightResourcePack([complete(1), complete(1)]), /重複/);
  await assert.rejects(buildLightweightResourcePack([complete(1)], 0), /pack_format/);
  await assert.rejects(buildLightweightResourcePack([complete(1)], 34.5), /pack_format/);
  const corrupt = complete(1);
  await assert.rejects(buildLightweightResourcePack([
    { ...corrupt, visual: { ...corrupt.visual!, processed: {
      ...corrupt.visual!.processed!, basePng: new Blob(['invalid']) } } },
  ]), /形式検証/);
});

test('GIF/video frames use their already selected, edited, untinted poster image', async () => {
  const slot = complete(2);
  const gif: NextbotSlot = { ...slot, visual: { ...slot.visual!,
    sourceFormat: 'gif', sourceName: 'animated.gif',
  } };
  const zip = await JSZip.loadAsync(await (await buildLightweightResourcePack([gif])).arrayBuffer());
  const texture = await zip.file('assets/runesnextbot/textures/nextbots/02.png')!.async('uint8array');
  assert.equal(texture[23], 11);
});
