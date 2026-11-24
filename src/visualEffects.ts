/** Animated visual effects for Minecraft texture strips. Rendering stays bounded to 24 frames. */
export const GAMING_FRAME_COUNT = 12;
export const GAMING_FRAME_TICKS = 2;

export type GamingMode = 'off' | 'global' | 'diagonal';
export type GamingDirection = 'tl-br' | 'tr-bl' | 'bl-tr' | 'br-tl';

export interface VisualEffectSettings {
  gamingMode: GamingMode;
  gamingDirection: GamingDirection;
  enchant: boolean;
  enchantStrength: number;
}

export function defaultVisualEffectSettings(): VisualEffectSettings {
  return { gamingMode: 'off', gamingDirection: 'tl-br', enchant: false, enchantStrength: 75 };
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

function hueShiftPixel(pixels: Uint8ClampedArray, i: number, shift: number): void {
  if (pixels[i + 3] === 0) return;
  const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = delta === 0 ? 0 : delta / Math.max(1e-6, 1 - Math.abs(2 * light - 1));
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / delta + 2) / 6;
    else hue = ((r - g) / delta + 4) / 6;
  }
  // Neutral midtones still pick up the rainbow so grayscale Nextbots visibly become "gaming".
  if (light > 0.03 && light < 0.97) saturation = Math.max(saturation, 0.55);
  hue = (hue + shift + 10) % 1;
  if (saturation === 0) return;
  const q = light < 0.5 ? light * (1 + saturation) : light + saturation - light * saturation;
  const p = 2 * light - q;
  pixels[i] = Math.round(hueToRgb(p, q, hue + 1 / 3) * 255);
  pixels[i + 1] = Math.round(hueToRgb(p, q, hue) * 255);
  pixels[i + 2] = Math.round(hueToRgb(p, q, hue - 1 / 3) * 255);
}

/** Mutates RGBA pixels in place. Phase 0..1 is one full rainbow turn. */
export function gamingHueShift(pixels: Uint8ClampedArray, phase: number): void {
  const shift = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  for (let i = 0; i < pixels.length; i += 4) hueShiftPixel(pixels, i, shift);
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
    gamingHueShift(pixels, phase);
    return;
  }
  const rainbowWidth = 0.9;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const travel = diagonalProgress(x, y, width, height, settings.gamingDirection);
      // Increasing phase moves a same-color band from the selected source corner to destination.
      hueShiftPixel(pixels, i, phase - travel * rainbowWidth);
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
 * Procedural glint layer. This deliberately uses no Minecraft texture or copied game code:
 * a small repeating "glint texture" is synthesized from waves, then rotated/scrolled like a
 * texture transform. Integer UV scrolling keeps phase 0 and 1 seamless for texture animation.
 */
function proceduralGlintLayer(
  nx: number, ny: number, phase: number,
  angleRadians: number, scale: number, scrollU: number, scrollV: number, seed: number,
): number {
  const x = nx - 0.5, y = ny - 0.5;
  const cos = Math.cos(angleRadians), sin = Math.sin(angleRadians);
  const rotatedU = (x * cos - y * sin) * scale + phase * scrollU + seed;
  const rotatedV = (x * sin + y * cos) * scale + phase * scrollV - seed * 0.37;

  // Bright diagonal ridges form the repeating texture motif.
  const ridgePosition = Math.abs(fract(rotatedU + rotatedV * 0.31) - 0.5);
  const core = 1 - smoothstep(0.045, 0.115, ridgePosition);
  const halo = 1 - smoothstep(0.095, 0.29, ridgePosition);
  const ridge = core * 0.72 + halo * 0.28;

  // Break the ridges into an irregular shimmer instead of a perfectly clean sine stripe.
  const grainA = 0.5 + 0.5 * Math.sin((rotatedU * 5.0 + rotatedV * 9.0 + seed) * Math.PI * 2);
  const grainB = 0.5 + 0.5 * Math.sin((rotatedU * 13.0 - rotatedV * 4.0 + seed * 1.7) * Math.PI * 2);
  // Continuous luminous bands: fine texture should enrich the streaks,
  // not break them into faint speckles.
  const grain = 0.74 + 0.26 * (grainA * 0.58 + grainB * 0.42);
  return Math.max(0, Math.min(1, ridge * grain));
}

/**
 * Vanilla-inspired, independently implemented glint intensity.
 * Two transformed procedural layers move at different angles/speeds, giving the crossed,
 * drifting shimmer associated with enchanted rendering while staying copyright-clean.
 */
export function enchantGlintIntensity(nx: number, ny: number, phase: number): number {
  const x = Math.max(0, Math.min(1, Number.isFinite(nx) ? nx : 0));
  const y = Math.max(0, Math.min(1, Number.isFinite(ny) ? ny : 0));
  const p = ((Number.isFinite(phase) ? phase : 0) % 1 + 1) % 1;
  const layerA = proceduralGlintLayer(x, y, p, Math.PI / 18, 3.3, -1, 2, 0.13);
  const layerB = proceduralGlintLayer(x, y, p, -5 * Math.PI / 18, 4.8, 2, 1, 0.61);
  const crossing = Math.sqrt(layerA * layerB);
  return Math.max(0, Math.min(1, layerA * 0.96 + layerB * 0.72 + crossing * 0.42));
}

function screenChannel(base: number, tint: number, amount: number): number {
  const screened = 255 - (255 - base) * (1 - (tint / 255) * amount);
  return Math.max(0, Math.min(255, Math.round(screened)));
}

function applyEnchantGlint(
  pixels: Uint8ClampedArray, width: number, height: number, phase: number, strength: number,
): void {
  const opacity = Math.max(0, Math.min(1, strength / 100));
  if (opacity <= 0) return;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] === 0) continue;
      const nx = width <= 1 ? 0 : x / (width - 1);
      const ny = height <= 1 ? 0 : y / (height - 1);
      const mask = enchantGlintIntensity(nx, ny, phase);
      if (mask <= 0.001) continue;

      const amount = Math.min(1, mask * opacity * 1.18);
      const coolShift = 0.5 + 0.5 * Math.sin((nx - ny + phase) * Math.PI * 2);
      const red = 205 + coolShift * 36;
      const green = 54 + coolShift * 46;
      const blue = 255;
      // Screen makes dark textures luminous, but pure white cannot become
      // brighter. Add a saturated violet tint on light textures as well.
      const luminance = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
      const tintMix = smoothstep(145, 245, luminance) * amount * 0.60;
      const tint = (base: number, color: number) =>
        Math.round(screenChannel(base, color, amount) * (1 - tintMix) + color * tintMix);
      pixels[i] = tint(pixels[i], red);
      pixels[i + 1] = tint(pixels[i + 1], green);
      pixels[i + 2] = tint(pixels[i + 2], blue);
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
  frameCount = GAMING_FRAME_COUNT,
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
      frames.push({ index, time: GAMING_FRAME_TICKS });
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
