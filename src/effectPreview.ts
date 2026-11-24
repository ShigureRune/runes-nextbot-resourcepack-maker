import {
  applyVisualEffectsToPixels, GAMING_FRAME_COUNT, GAMING_FRAME_TICKS,
  hasAnimatedVisualEffects, normalizeVisualEffects,
} from './visualEffects.ts';
import type { VisualEffectSettings } from './visualEffects.ts';

/** Match the frame count and Minecraft tick duration of exported visual effects. */
export function effectPreviewTiming(rawSettings: VisualEffectSettings): { frameCount: number; delayMs: number } {
  const settings = normalizeVisualEffects(rawSettings);
  if (!hasAnimatedVisualEffects(settings)) return { frameCount: 1, delayMs: 0 };
  return settings.enchant
    ? { frameCount: 24, delayMs: 50 }
    : { frameCount: GAMING_FRAME_COUNT, delayMs: GAMING_FRAME_TICKS * 50 };
}

/** Browser-synchronized 60fps preview; exported Minecraft textures still use game ticks. */
export class VisualEffectPreviewPlayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private original: ImageData | null = null;
  private frame: ImageData | null = null;
  private settings: VisualEffectSettings | null = null;
  private frameIndex = 0;
  private playing = false;
  private request: number | ReturnType<typeof setTimeout> | null = null;
  private usingRaf = false;
  private startMs = 0;
  private elapsedMs = 0;
  private lastPaintMs = -Infinity;
  private readonly onFrame: (index: number, count: number) => void;

  constructor(canvas: HTMLCanvasElement, onFrame: (index: number, count: number) => void = () => {}) {
    this.canvas = canvas;
    this.onFrame = onFrame;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2Dを利用できません。');
    this.context = context;
  }

  get isAnimated(): boolean {
    return this.settings !== null && hasAnimatedVisualEffects(this.settings);
  }
  get isPlaying(): boolean { return this.playing; }

  clear(): void {
    this.pause();
    this.original = null;
    this.frame = null;
    this.settings = null;
    this.frameIndex = 0;
    this.elapsedMs = 0;
    this.lastPaintMs = -Infinity;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onFrame(0, 0);
  }

  setSource(image: ImageBitmap, rawSettings: VisualEffectSettings): void {
    this.clear();
    this.canvas.width = image.width;
    this.canvas.height = image.height;
    this.context.drawImage(image, 0, 0);
    this.original = this.context.getImageData(0, 0, image.width, image.height);
    this.frame = this.context.createImageData(image.width, image.height);
    this.settings = normalizeVisualEffects(rawSettings);
    this.draw(0);
    this.play();
  }

  play(): void {
    if (this.playing || !this.isAnimated || !this.original) return;
    this.playing = true;
    this.startMs = this.clock() - this.elapsedMs;
    this.schedule();
  }

  pause(): void {
    if (!this.playing) return;
    this.elapsedMs = Math.max(0, this.clock() - this.startMs);
    this.playing = false;
    if (this.request !== null) {
      if (this.usingRaf) cancelAnimationFrame(this.request as number);
      else clearTimeout(this.request);
    }
    this.request = null;
  }

  private clock(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private schedule(): void {
    if (!this.playing) return;
    this.usingRaf = typeof requestAnimationFrame === 'function';
    if (this.usingRaf) this.request = requestAnimationFrame(time => this.tick(time));
    else this.request = setTimeout(() => this.tick(this.clock()), 1000 / 60);
  }

  private tick(now: number): void {
    this.request = null;
    if (!this.playing || !this.settings) return;
    this.elapsedMs = Math.max(0, now - this.startMs);
    // Respect screen refresh and avoid unnecessary CPU work on high-Hz displays.
    if (now - this.lastPaintMs >= 1000 / 60 - 1) {
      const { frameCount, delayMs } = effectPreviewTiming(this.settings);
      const loopMs = frameCount * delayMs;
      const position = loopMs ? this.elapsedMs % loopMs : 0;
      this.frameIndex = loopMs ? Math.floor(position / delayMs) : 0;
      this.lastPaintMs = now;
      this.draw(loopMs ? position / loopMs : 0);
    }
    this.schedule();
  }

  private draw(phase: number): void {
    if (!this.original || !this.settings || !this.frame) return;
    const { frameCount } = effectPreviewTiming(this.settings);
    this.frame.data.set(this.original.data);
    if (frameCount > 1) {
      applyVisualEffectsToPixels(this.frame.data, this.frame.width, this.frame.height,
        phase, this.settings);
    }
    this.context.putImageData(this.frame, 0, 0);
    this.onFrame(this.frameIndex, frameCount);
  }
}
