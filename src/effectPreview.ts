import {
  applyVisualEffectsToPixels, GAMING_FRAME_COUNT, GAMING_FRAME_TICKS,
  hasAnimatedVisualEffects, normalizeVisualEffects,
} from './visualEffects';
import type { VisualEffectSettings } from './visualEffects';

/** Match the frame count and Minecraft tick duration of exported visual effects. */
export function effectPreviewTiming(rawSettings: VisualEffectSettings): { frameCount: number; delayMs: number } {
  const settings = normalizeVisualEffects(rawSettings);
  if (!hasAnimatedVisualEffects(settings)) return { frameCount: 1, delayMs: 0 };
  return settings.enchant
    ? { frameCount: 24, delayMs: 50 }
    : { frameCount: GAMING_FRAME_COUNT, delayMs: GAMING_FRAME_TICKS * 50 };
}

/** Live preview without repeatedly encoding large PNG sprite strips (mobile-friendly). */
export class VisualEffectPreviewPlayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private original: ImageData | null = null;
  private settings: VisualEffectSettings | null = null;
  private frameIndex = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2Dを利用できません。');
    this.context = context;
  }

  get isAnimated(): boolean {
    return this.settings !== null && hasAnimatedVisualEffects(this.settings);
  }

  clear(): void {
    this.pause();
    this.original = null;
    this.settings = null;
    this.frameIndex = 0;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setSource(image: ImageBitmap, rawSettings: VisualEffectSettings): void {
    this.clear();
    this.canvas.width = image.width;
    this.canvas.height = image.height;
    this.context.drawImage(image, 0, 0);
    this.original = this.context.getImageData(0, 0, image.width, image.height);
    this.settings = normalizeVisualEffects(rawSettings);
    this.draw();
    this.play();
  }

  play(): void {
    if (this.timer !== null || !this.isAnimated || !this.original) return;
    this.schedule();
  }

  pause(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (!this.settings || !this.original || this.timer !== null) return;
    const { frameCount, delayMs } = effectPreviewTiming(this.settings);
    if (frameCount < 2) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.original || !this.settings) return;
      this.frameIndex = (this.frameIndex + 1) % frameCount;
      this.draw();
      this.schedule();
    }, delayMs);
  }

  private draw(): void {
    if (!this.original || !this.settings) return;
    const { frameCount } = effectPreviewTiming(this.settings);
    const frame = this.context.createImageData(this.original.width, this.original.height);
    frame.data.set(this.original.data);
    if (frameCount > 1) {
      applyVisualEffectsToPixels(frame.data, frame.width, frame.height,
        this.frameIndex / frameCount, this.settings);
    }
    this.context.putImageData(frame, 0, 0);
  }
}
