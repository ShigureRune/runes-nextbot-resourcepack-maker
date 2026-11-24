/** Browser-only static PNG editor. Chroma key affects pixels inside the crop only. */
export interface ImageEditSettings {
  x: number; y: number; width: number; height: number;
  keyEnabled: boolean; keyColor: string; tolerance: number; feather: number;
  resolution: 128 | 256;
}
export function defaultImageSettings(width: number, height: number): ImageEditSettings {
  return { x: 0, y: 0, width, height, keyEnabled: false, keyColor: '#00ff00', tolerance: 45, feather: 20, resolution: 256 };
}
export function cropBounds(settings: ImageEditSettings, width: number, height: number) {
  const x = Math.max(0, Math.min(width - 1, Math.floor(settings.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(settings.y)));
  return { x, y, width: Math.max(1, Math.min(width - x, Math.floor(settings.width))),
    height: Math.max(1, Math.min(height - y, Math.floor(settings.height))) };
}
function keyRgb(hex: string): [number, number, number] {
  const valid = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#00ff00';
  return [1, 3, 5].map(i => parseInt(valid.slice(i, i + 2), 16)) as [number, number, number];
}
export function chromaKey(data: Uint8ClampedArray, color: string, tolerance: number, feather: number): void {
  const [r, g, b] = keyRgb(color);
  const start = Math.max(0, tolerance);
  const fade = Math.max(0, feather);
  for (let i = 0; i < data.length; i += 4) {
    const distance = Math.hypot(data[i] - r, data[i + 1] - g, data[i + 2] - b);
    const factor = fade === 0 ? (distance <= start ? 0 : 1) : Math.max(0, Math.min(1, (distance - start) / fade));
    data[i + 3] = Math.round(data[i + 3] * factor);
  }
}
export async function loadPng(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}
/** Fit without distortion. Align all edges to whole output pixels. */
export function imageFit(width: number, height: number, resolution: 128 | 256) {
  const scale = Math.min(resolution / width, resolution / height);
  const w = Math.max(1, Math.min(resolution, Math.round(width * scale)));
  const h = Math.max(1, Math.min(resolution, Math.round(height * scale)));
  return { x: Math.floor((resolution - w) / 2), y: Math.floor((resolution - h) / 2),
    width: w, height: h, smoothing: scale < 1 };
}
/** High-quality downsampling; nearest-neighbor upsampling preserves pixel edges. */
export async function fitImagePng(source: CanvasImageSource, width: number, height: number, resolution: 128 | 256 = 256): Promise<Blob> {
  const output = document.createElement('canvas');
  output.width = resolution; output.height = resolution;
  const out = output.getContext('2d');
  if (!out) throw new Error('Canvas 2Dを利用できません');
  const fit = imageFit(width, height, resolution);
  out.imageSmoothingEnabled = fit.smoothing;
  out.imageSmoothingQuality = 'high';
  out.drawImage(source, fit.x, fit.y, fit.width, fit.height);
  try {
    return await new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob && blob.size > 0 ? resolve(blob) : reject(new Error('PNG生成に失敗しました')), 'image/png'));
  } finally {
    output.width = 1; output.height = 1;
  }
}
export async function processPng(source: ImageBitmap, settings: ImageEditSettings): Promise<Blob> {
  const bounds = cropBounds(settings, source.width, source.height);
  // Work on the original crop first so keying cannot alter pixels outside the selection.
  const crop = document.createElement('canvas');
  crop.width = bounds.width; crop.height = bounds.height;
  const context = crop.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2Dを利用できません');
  context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  if (settings.keyEnabled) {
    const pixels = context.getImageData(0, 0, crop.width, crop.height);
    chromaKey(pixels.data, settings.keyColor, settings.tolerance, settings.feather);
    context.putImageData(pixels, 0, 0);
  }
  try {
    return await fitImagePng(crop, crop.width, crop.height, settings.resolution);
  } finally {
    crop.width = 1; crop.height = 1;
  }
}
export function sampleColor(source: ImageBitmap, x: number, y: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2Dを利用できません');
  context.drawImage(source, Math.max(0, Math.min(source.width - 1, Math.floor(x))), Math.max(0, Math.min(source.height - 1, Math.floor(y))), 1, 1, 0, 0, 1, 1);
  return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
}
