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
        !Number.isInteger(entry.time) || entry.time < 1 || entry.time > 200) {
      throw new Error('フレームの再生時間が不正です。');
    }
    return entry.time;
  });
}

export function previewDelayMs(ticks: number, speed: number): number {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 200 ||
      !Number.isFinite(speed) || speed < 0.25 || speed > 2) {
    throw new RangeError('アニメーションの再生設定が不正です。');
  }
  // Minecraft animation metadata uses 50ms ticks; speed only changes preview.
  return ticks * 50 / speed;
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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onFrame: (frame: number, count: number, playing: boolean) => void,
  ) {}

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
        !ticks.length || ticks.some(tick => !Number.isInteger(tick) || tick < 1 || tick > 200)) {
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
