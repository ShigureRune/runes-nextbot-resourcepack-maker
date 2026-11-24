/** Rainbow/"gaming" texture effect helpers. Browser rendering stays bounded to 24 frames. */
export const GAMING_FRAME_COUNT = 12;
export const GAMING_FRAME_TICKS = 2;

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

/** Mutates RGBA pixels in place. Phase 0..1 is one full rainbow turn. */
export function gamingHueShift(pixels: Uint8ClampedArray, phase: number): void {
  const shift = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const light = (max + min) / 2;
    const delta = max - min;
    let hue = 0;
    let saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
    if (delta !== 0) {
      if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
      else if (max === g) hue = ((b - r) / delta + 2) / 6;
      else hue = ((r - g) / delta + 4) / 6;
    }
    // Give neutral pixels some color so grayscale art also visibly becomes "gaming".
    if (light > 0.03 && light < 0.97) saturation = Math.max(saturation, 0.55);
    hue = (hue + shift) % 1;
    let rr: number, gg: number, bb: number;
    if (saturation === 0) {
      rr = gg = bb = light;
    } else {
      const q = light < 0.5 ? light * (1 + saturation) : light + saturation - light * saturation;
      const p = 2 * light - q;
      rr = hueToRgb(p, q, hue + 1 / 3);
      gg = hueToRgb(p, q, hue);
      bb = hueToRgb(p, q, hue - 1 / 3);
    }
    pixels[i] = Math.round(rr * 255);
    pixels[i + 1] = Math.round(gg * 255);
    pixels[i + 2] = Math.round(bb * 255);
  }
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(new Error('ゲーミングPNGを書き出せませんでした。')), 'image/png'));
}

export async function applyGamingFramePng(source: Blob, phase: number): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2Dを利用できません。');
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    gamingHueShift(image.data, phase);
    context.putImageData(image, 0, 0);
    return await canvasPng(canvas);
  } finally {
    bitmap.close();
  }
}

/** Turn one processed square PNG into a Minecraft vertical animation strip. */
export async function createGamingAnimation(
  source: Blob,
  frameCount = GAMING_FRAME_COUNT,
): Promise<{ png: Blob; previewPng: Blob; animationMcmeta: string; frameCount: number }> {
  if (!Number.isInteger(frameCount) || frameCount < 2 || frameCount > 24) {
    throw new RangeError('ゲーミングアニメーションは2〜24フレームで生成してください。');
  }
  const bitmap = await createImageBitmap(source);
  try {
    if (bitmap.width < 1 || bitmap.width !== bitmap.height || bitmap.width > 256) {
      throw new Error('ゲーミング化する画像は256×256px以下の正方形にしてください。');
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
      gamingHueShift(pixels.data, index / frameCount);
      frameContext.putImageData(pixels, 0, 0);
      spriteContext.drawImage(frameCanvas, 0, index * size);
      if (index === 0) previewPng = await canvasPng(frameCanvas);
      frames.push({ index, time: GAMING_FRAME_TICKS });
    }
    if (!previewPng) throw new Error('ゲーミングプレビューを生成できませんでした。');
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
