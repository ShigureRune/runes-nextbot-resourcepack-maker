/** Animated visual effects for Minecraft texture strips. Rendering stays bounded to 24 frames. */
export const GAMING_FRAME_COUNT = 24;
export const GAMING_FRAME_TICKS = 1;

export type GamingMode = 'off' | 'global' | 'diagonal';
export type GamingDirection = 'tl-br' | 'tr-bl' | 'bl-tr' | 'br-tl';

export interface VisualEffectSettings {
  gamingMode: GamingMode;
  gamingDirection: GamingDirection;
  enchant: boolean;
  enchantStrength: number;
}

export function defaultVisualEffectSettings(): VisualEffectSettings {
  return { gamingMode: 'off', gamingDirection: 'tl-br', enchant: false, enchantStrength: 35 };
}

export function normalizeVisualEffects(value: unknown, legacyGaming = false): VisualEffectSettings {
  const defaults = defaultVisualEffectSettings();
  if (!value || typeof value !== 'object') {
    return legacyGaming ? { ...defaults, gamingMode: 'global' } : defaults;
  }
  const source = value as Partial<VisualEffectSettings>;
  const gamingMode: GamingMode =
    source.gamingMode === 'global' || source.gamingMode === 'diagonal' || source.gamingMode === 'off'
      ? source.gamingMode : (legacyGaming ? 'global' : 'off');
  const gamingDirection: GamingDirection =
    source.gamingDirection === 'tr-bl' || source.gamingDirection === 'bl-tr' ||
    source.gamingDirection === 'br-tl' || source.gamingDirection === 'tl-br'
      ? source.gamingDirection : 'tl-br';
  const rawStrength = typeof source.enchantStrength === 'number' ? source.enchantStrength : defaults.enchantStrength;
  return {
    gamingMode,
    gamingDirection,
    enchant: source.enchant === true,
    enchantStrength: Math.max(0, Math.min(100, Math.round(Number.isFinite(rawStrength) ? rawStrength : defaults.enchantStrength))),
  };
}

export function hasAnimatedVisualEffects(settings: VisualEffectSettings): boolean {
  return settings.gamingMode !== 'off' || settings.enchant;
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

/** A single translucent rainbow-colored sheet over the untouched source texture. */
export const GAMING_OVERLAY_OPACITY = 0.45;

function overlayGamingPixel(pixels: Uint8ClampedArray, i: number, phase: number): void {
  // Respect the original alpha mask: transparent background never becomes visible.
  if (pixels[i + 3] === 0) return;
  const hue = phase - Math.floor(phase);
  const keep = 1 - GAMING_OVERLAY_OPACITY;
  // The tint depends only on animation phase/position, never on the base pixel hue.
  const r = hueToRgb(0, 1, hue + 1 / 3) * 255;
  const g = hueToRgb(0, 1, hue) * 255;
  const b = hueToRgb(0, 1, hue - 1 / 3) * 255;
  pixels[i] = Math.round(pixels[i] * keep + r * GAMING_OVERLAY_OPACITY);
  pixels[i + 1] = Math.round(pixels[i + 1] * keep + g * GAMING_OVERLAY_OPACITY);
  pixels[i + 2] = Math.round(pixels[i + 2] * keep + b * GAMING_OVERLAY_OPACITY);
}

/** 0 is the selected source corner and 1 is the selected destination corner. */
export function diagonalProgress(
  x: number, y: number, width: number, height: number, direction: GamingDirection,
): number {
  const w = Math.max(1, width - 1), h = Math.max(1, height - 1);
  const nx = Math.max(0, Math.min(1, x / w));
  const ny = Math.max(0, Math.min(1, y / h));
  switch (direction) {
    case 'tr-bl': return ((1 - nx) + ny) / 2;
    case 'bl-tr': return (nx + (1 - ny)) / 2;
    case 'br-tl': return ((1 - nx) + (1 - ny)) / 2;
    default: return (nx + ny) / 2;
  }
}

function applyGaming(
  pixels: Uint8ClampedArray, width: number, height: number, phase: number, settings: VisualEffectSettings,
): void {
  if (settings.gamingMode === 'off') return;
  if (settings.gamingMode === 'global') {
    // A uniform, semi-transparent color sheet: every position receives one hue.
    for (let i = 0; i < pixels.length; i += 4) overlayGamingPixel(pixels, i, phase);
    return;
  }
  const rainbowWidth = 0.9;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const travel = diagonalProgress(x, y, width, height, settings.gamingDirection);
      // The same translucent sheet, with rainbow hue flowing along the selected diagonal.
      overlayGamingPixel(pixels, i, phase - travel * rainbowWidth);
    }
  }
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Smooth specular ribbon, independently generated without game assets.
 * One diagonal coordinate drives the entire reflection: no crossing lattice,
 * speckle, or second stripe direction. A full phase is exactly one repeat.
 */
function glintDistance(nx: number, ny: number, phase: number): number {
  const x = Math.max(0, Math.min(1, Number.isFinite(nx) ? nx : 0));
  const y = Math.max(0, Math.min(1, Number.isFinite(ny) ? ny : 0));
  const p = Number.isFinite(phase) ? phase : 0;
  return fract(x * 0.78 + y * 0.52 - p + 0.09) - 0.5;
}

function ribbonMask(distance: number): number {
  // A soft violet band with an unlit gap, not a full-screen purple wash.
  return 1 - smoothstep(0.06, 0.27, Math.abs(distance));
}

export function enchantGlintIntensity(nx: number, ny: number, phase: number): number {
  return ribbonMask(glintDistance(nx, ny, phase));
}

/**
 * Subtle, satin-like purple glint, inspired by the unobtrusive look of
 * modern Minecraft enchantment overlays. All colors are generated locally;
 * no Minecraft texture or rendering asset is embedded.
 *
 * Unlike the old screen/white-specular formula, this composites a low-opacity
 * purple sheet into the original RGB. Bright and white pixels therefore keep
 * their structure, black pixels receive a readable faint purple glimmer,
 * and no color channel gets an overpowering white hotspot.
 */
function applyEnchantGlint(
  pixels: Uint8ClampedArray, width: number, height: number, phase: number, strength: number,
): void {
  const power = Math.max(0, Math.min(1, strength / 100));
  if (power <= 0) return;
  for (let y = 0; y < height; y++) {
    const ny = height <= 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] === 0) continue;
      const nx = width <= 1 ? 0 : x / (width - 1);
      const distance = glintDistance(nx, ny, phase);
      const band = ribbonMask(distance);
      if (band < 0.001) continue;

      // A faint, narrower satin reflection travels inside the broad violet band.
      // Both use the same diagonal, avoiding the old cross-hatched grid artifact.
      const core = (1 - smoothstep(0.012, 0.085, Math.abs(distance - 0.018))) * band;
      const cool = smoothstep(-0.22, 0.22, distance);
      const violetR = 152 - 32 * cool;
      const violetG = 82 + 16 * cool;
      const violetB = 213 + 18 * cool;
      const tintOpacity = power * (0.24 * band + 0.04 * core);
      const satinOpacity = power * 0.03 * core;
      // Preserve image alpha, details and perceived brightness. No additive white.
      const mix = (base: number, violet: number, highlight: number) => {
        const tinted = base + (violet - base) * tintOpacity;
        return Math.round(tinted + (highlight - tinted) * satinOpacity);
      };
      pixels[i] = mix(pixels[i], violetR, 205);
      pixels[i + 1] = mix(pixels[i + 1], violetG, 195);
      pixels[i + 2] = mix(pixels[i + 2], violetB, 232);
    }
  }
}

export function applyVisualEffectsToPixels(
  pixels: Uint8ClampedArray, width: number, height: number, phase: number, rawSettings: VisualEffectSettings,
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      pixels.length !== width * height * 4) {
    throw new RangeError('エフェクト対象の画像サイズが不正です。');
  }
  const settings = normalizeVisualEffects(rawSettings);
  const normalizedPhase = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  applyGaming(pixels, width, height, normalizedPhase, settings);
  if (settings.enchant) applyEnchantGlint(pixels, width, height, normalizedPhase, settings.enchantStrength);
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(new Error('エフェクトPNGを書き出せませんでした。')), 'image/png'));
}

export async function applyVisualEffectsFramePng(
  source: Blob, phase: number, settings: VisualEffectSettings,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2Dを利用できません。');
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    applyVisualEffectsToPixels(image.data, canvas.width, canvas.height, phase, settings);
    context.putImageData(image, 0, 0);
    return await canvasPng(canvas);
  } finally {
    bitmap.close();
  }
}

/** Turn one processed square PNG into a Minecraft vertical animation strip. */
export async function createVisualEffectAnimation(
  source: Blob,
  rawSettings: VisualEffectSettings,
  frameCount = rawSettings.enchant ? 24 : GAMING_FRAME_COUNT,
): Promise<{ png: Blob; previewPng: Blob; animationMcmeta: string; frameCount: number }> {
  const settings = normalizeVisualEffects(rawSettings);
  if (!hasAnimatedVisualEffects(settings)) throw new Error('動く画像エフェクトが選択されていません。');
  if (!Number.isInteger(frameCount) || frameCount < 2 || frameCount > 24) {
    throw new RangeError('エフェクトアニメーションは2〜24フレームで生成してください。');
  }
  const bitmap = await createImageBitmap(source);
  try {
    if (bitmap.width < 1 || bitmap.width !== bitmap.height || bitmap.width > 256) {
      throw new Error('エフェクト化する画像は256×256px以下の正方形にしてください。');
    }
    const size = bitmap.width;
    const base = document.createElement('canvas');
    base.width = size; base.height = size;
    const baseContext = base.getContext('2d', { willReadFrequently: true });
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = size; frameCanvas.height = size;
    const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });
    const sprite = document.createElement('canvas');
    sprite.width = size; sprite.height = size * frameCount;
    const spriteContext = sprite.getContext('2d');
    if (!baseContext || !frameContext || !spriteContext) throw new Error('Canvas 2Dを利用できません。');
    baseContext.drawImage(bitmap, 0, 0);
    const original = baseContext.getImageData(0, 0, size, size);
    let previewPng: Blob | null = null;
    const frames: Array<{ index: number; time: number }> = [];
    for (let index = 0; index < frameCount; index++) {
      const pixels = new ImageData(new Uint8ClampedArray(original.data), size, size);
      applyVisualEffectsToPixels(pixels.data, size, size, index / frameCount, settings);
      frameContext.putImageData(pixels, 0, 0);
      spriteContext.drawImage(frameCanvas, 0, index * size);
      if (index === 0) previewPng = await canvasPng(frameCanvas);
      frames.push({ index, time: settings.enchant && frameCount === 24 ? 1 : GAMING_FRAME_TICKS });
    }
    if (!previewPng) throw new Error('エフェクトプレビューを生成できませんでした。');
    return {
      png: await canvasPng(sprite),
      previewPng,
      animationMcmeta: JSON.stringify({ animation: { frametime: 1, frames } }, null, 2),
      frameCount,
    };
  } finally {
    bitmap.close();
  }
}

/** Backward-compatible helpers for slots created by the first gaming implementation. */
export function applyGamingFramePng(source: Blob, phase: number): Promise<Blob> {
  return applyVisualEffectsFramePng(source, phase, { ...defaultVisualEffectSettings(), gamingMode: 'global' });
}
export function createGamingAnimation(
  source: Blob, frameCount = GAMING_FRAME_COUNT,
): Promise<{ png: Blob; previewPng: Blob; animationMcmeta: string; frameCount: number }> {
  return createVisualEffectAnimation(source, { ...defaultVisualEffectSettings(), gamingMode: 'global' }, frameCount);
}
