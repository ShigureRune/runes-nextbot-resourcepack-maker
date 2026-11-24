/** Shared timing rules for preview and the exported Minecraft animation metadata. */
export const GIF_SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;
export type GifSpeed = typeof GIF_SPEEDS[number];

export function normalizeGifSpeed(value: unknown): GifSpeed {
  return typeof value === 'number' && GIF_SPEEDS.some(speed => speed === value)
    ? value as GifSpeed : 1;
}

/** Scale and round exactly as exported .png.mcmeta: Minecraft runs 20 ticks/s. */
export function retimedFrameTicks(ticks: number, speed: number): number {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 10000 ||
      !Number.isFinite(speed) || speed < 0.25 || speed > 2) {
    throw new RangeError('GIFの再生速度またはフレーム時間が不正です。');
  }
  return Math.max(1, Math.min(10000, Math.round(ticks / speed)));
}

/** The downloaded metadata and the preview must use precisely the same durations. */
export function retimeAnimationMcmeta(metadata: string, speed: number): string {
  const doc: unknown = JSON.parse(metadata);
  if (!doc || typeof doc !== 'object' || !('animation' in doc) ||
      !doc.animation || typeof doc.animation !== 'object' ||
      !('frames' in doc.animation) || !Array.isArray(doc.animation.frames)) {
    throw new Error('アニメーションの時間情報が不正です。');
  }
  const baseTicks = previewTicksFromMcmeta(metadata, doc.animation.frames.length);
  const frames = baseTicks.map((ticks, index) =>
    ({ index, time: retimedFrameTicks(ticks, speed) }));
  return JSON.stringify({ animation: { frametime: 1, frames } }, null, 2);
}

/** Timing-aware preview of the generated Minecraft animation sprite strip. */
export function previewTicksFromMcmeta(metadata: string, frameCount: number): number[] {
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 24) {
    throw new RangeError('プレビューできるフレーム数が不正です。');
  }
  const parsed: unknown = JSON.parse(metadata);
  if (!parsed || typeof parsed !== 'object' || !('animation' in parsed)) {
    throw new Error('アニメーション情報がありません。');
  }
  const animation = parsed.animation;
  if (!animation || typeof animation !== 'object' || !('frames' in animation) ||
      !Array.isArray(animation.frames) || animation.frames.length !== frameCount) {
    throw new Error('フレームの再生情報が不正です。');
  }
  return animation.frames.map((entry: unknown, index: number): number => {
    if (!entry || typeof entry !== 'object' || !('index' in entry) || !('time' in entry) ||
        entry.index !== index || typeof entry.time !== 'number' ||
        !Number.isInteger(entry.time) || entry.time < 1 || entry.time > 10000) {
      throw new Error('フレームの再生時間が不正です。');
    }
    return entry.time;
  });
}

export function previewDelayMs(ticks: number, speed: number): number {
  // Delays are quantized to whole 50ms game ticks, not arbitrary JS fractions.
  return retimedFrameTicks(ticks, speed) * 50;
}

export function nextPreviewFrame(index: number, count: number, loop: boolean): number | null {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError('フレームの番号が不正です。');
  }
  if (index + 1 < count) return index + 1;
  return loop ? 0 : null;
}

/** Owns a decoded sprite bitmap, closes it on replacement, and schedules frame changes. */
export class GifPreviewPlayer {
  private sprite: ImageBitmap | null = null;
  private ticks: number[] = [];
  private current = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;
  private speed = 1;
  private loop = true;

  private readonly canvas: HTMLCanvasElement;
  private readonly onFrame: (frame: number, count: number, playing: boolean) => void;

  constructor(
    canvas: HTMLCanvasElement,
    onFrame: (frame: number, count: number, playing: boolean) => void,
  ) {
    this.canvas = canvas;
    this.onFrame = onFrame;
  }

  get hasFrames(): boolean { return this.sprite !== null; }
  get isPlaying(): boolean { return this.playing; }

  clear(): void {
    this.stopTimer();
    this.playing = false;
    this.sprite?.close();
    this.sprite = null;
    this.ticks = [];
    this.current = 0;
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onFrame(0, 0, false);
  }

  setFrames(sprite: ImageBitmap, ticks: number[]): void {
    if (sprite.width < 1 || sprite.height !== sprite.width * ticks.length ||
        !ticks.length || ticks.some(tick => !Number.isInteger(tick) || tick < 1 || tick > 10000)) {
      sprite.close();
      throw new Error('プレビュー画像とフレーム情報が一致しません。');
    }
    this.clear();
    this.sprite = sprite;
    this.ticks = [...ticks];
    this.canvas.width = sprite.width;
    this.canvas.height = sprite.width;
    this.current = 0;
    this.draw();
    this.play();
  }

  setSpeed(speed: number): void {
    previewDelayMs(1, speed);
    this.speed = speed;
    if (this.playing) this.schedule();
  }

  setLoop(loop: boolean): void { this.loop = loop; }

  toggle(): void { if (this.playing) this.pause(); else this.play(); }

  play(): void {
    if (!this.sprite || this.playing) return;
    // Restart a finished non-looping animation when play is pressed again.
    if (!this.loop && this.current === this.ticks.length - 1) this.current = 0;
    this.playing = true;
    this.draw();
    this.schedule();
  }

  pause(): void {
    this.stopTimer();
    this.playing = false;
    this.onFrame(this.current, this.ticks.length, false);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.stopTimer();
    if (!this.sprite || !this.playing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.sprite || !this.playing) return;
      const next = nextPreviewFrame(this.current, this.ticks.length, this.loop);
      if (next === null) { this.pause(); return; }
      this.current = next;
      this.draw();
      this.schedule();
    }, previewDelayMs(this.ticks[this.current], this.speed));
  }

  private draw(): void {
    if (!this.sprite) return;
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      const size = this.sprite.width;
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.sprite, 0, this.current * size, size, size, 0, 0, size, size);
    }
    this.onFrame(this.current, this.ticks.length, this.playing);
  }
}
