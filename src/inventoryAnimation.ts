import { previewTicksFromMcmeta, previewDelayMs } from './gifPlayback.ts';

/** The inventory uses the exact Minecraft frame durations but interpolates color-only effects. */
export function spritePosition(ticks: number[], speed: number, elapsedMs: number): {
  index: number; next: number; blend: number;
} {
  if (!ticks.length || ticks.some(t => !Number.isInteger(t) || t < 1)) {
    throw new RangeError('アニメーションのフレーム情報が不正です。');
  }
  const durations = ticks.map(tick => previewDelayMs(tick, speed));
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  let position = ((Number.isFinite(elapsedMs) ? elapsedMs : 0) % total + total) % total;
  for (let i = 0; i < durations.length; i++) {
    if (position < durations[i] || i === durations.length - 1) {
      return { index: i, next: (i + 1) % ticks.length, blend: position / durations[i] };
    }
    position -= durations[i];
  }
  return { index: 0, next: 0, blend: 0 };
}

interface SlotAnimation {
  id: number;
  canvas: HTMLCanvasElement;
  png: Blob;
  mcmeta: string;
  speed: number;
  interpolate: boolean;
  ticks: number[];
  visible: boolean;
  loading: boolean;
  generation: number;
  thumb: HTMLCanvasElement | null;
  frames: Uint8ClampedArray[] | null;
  output: ImageData | null;
  lastIndex: number;
}

/**
 * One shared requestAnimationFrame loop for the entire 99-slot inventory.
 * Only visible slots are decoded and drawn; offscreen sprite caches are released.
 */
export class InventoryAnimationController {
  private readonly records = new Map<number, SlotAnimation>();
  private readonly observer: IntersectionObserver | null;
  private readonly scroll: HTMLElement;
  private visible = true;
  private raf: number | null = null;
  private lastPaint = -Infinity;
  private activeDecodes = 0;
  private readonly queue = new Set<number>();

  constructor(scroll: HTMLElement) {
    this.scroll = scroll;
    this.observer = typeof IntersectionObserver === 'undefined' ? null
      : new IntersectionObserver(entries => {
        for (const entry of entries) {
          const id = Number((entry.target as HTMLCanvasElement).dataset.animationSlot);
          const item = this.records.get(id);
          if (!item || item.canvas !== entry.target) continue;
          this.setItemVisible(item, entry.isIntersecting);
        }
      }, { root: scroll, threshold: 0.01 });
    scroll.addEventListener('scroll', () => {
      if (!this.observer) this.recheckVisibility();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.recheckVisibility();
    });
    window.addEventListener('pagehide', () => {
      this.stop();
      for (const item of this.records.values()) {
        item.visible = false;
        this.release(item);
      }
    });
    window.addEventListener('pageshow', () => this.recheckVisibility());
    window.addEventListener('resize', () => this.recheckVisibility(), { passive: true });
  }

  update(id: number, canvas: HTMLCanvasElement, png: Blob, mcmeta: string,
    speed: number, interpolate: boolean): void {
    const prior = this.records.get(id);
    if (prior && prior.canvas === canvas && prior.png === png &&
        prior.mcmeta === mcmeta && prior.speed === speed && prior.interpolate === interpolate) return;
    if (prior) this.remove(id);
    let ticks: number[];
    try {
      const metadata = JSON.parse(mcmeta) as { animation?: { frames?: unknown[] } };
      ticks = previewTicksFromMcmeta(mcmeta, metadata.animation?.frames?.length ?? 0);
    } catch {
      return; // Leave the static preview visible for malformed or legacy assets.
    }
    canvas.width = 48;
    canvas.height = 48;
    canvas.dataset.animationSlot = String(id);
    // Keep the canvas in layout so IntersectionObserver can see it before decoding.
    canvas.hidden = false;
    canvas.style.opacity = '0';
    const item: SlotAnimation = {
      id, canvas, png, mcmeta, speed, interpolate, ticks, visible: false,
      loading: false, generation: 0, thumb: null, frames: null, output: null, lastIndex: -1,
    };
    this.records.set(id, item);
    if (this.observer) this.observer.observe(canvas);
    else this.recheckVisibility();
  }

  remove(id: number): void {
    const item = this.records.get(id);
    if (!item) return;
    this.observer?.unobserve(item.canvas);
    this.release(item);
    this.records.delete(id);
    this.queue.delete(id);
    if (![...this.records.values()].some(x => x.visible && x.thumb)) this.stop();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.stop();
      for (const item of this.records.values()) {
        item.visible = false;
        this.release(item);
      }
    } else this.recheckVisibility();
  }

  refresh(): void {
    this.recheckVisibility();
  }

  private recheckVisibility(): void {
    if (!this.visible || document.hidden) return;
    const viewport = this.scroll.getBoundingClientRect();
    for (const item of this.records.values()) {
      const rect = item.canvas.getBoundingClientRect();
      this.setItemVisible(item,
        rect.bottom > viewport.top && rect.top < viewport.bottom &&
        rect.right > viewport.left && rect.left < viewport.right);
    }
  }

  private setItemVisible(item: SlotAnimation, shown: boolean): void {
    const shouldShow = shown && this.visible && !document.hidden;
    if (item.visible === shouldShow) return;
    item.visible = shouldShow;
    if (shouldShow) {
      if (!item.thumb && !item.loading) this.queue.add(item.id);
      this.pump();
    } else this.release(item);
    if ([...this.records.values()].some(x => x.visible && x.thumb)) this.start();
    else this.stop();
  }

  private release(item: SlotAnimation): void {
    item.generation++;
    item.thumb = null;
    item.frames = null;
    item.output = null;
    item.lastIndex = -1;
    item.canvas.style.opacity = '0';
    this.queue.delete(item.id);
  }

  private pump(): void {
    if (!this.visible || document.hidden) return;
    while (this.activeDecodes < 2 && this.queue.size) {
      const id = this.queue.values().next().value as number;
      this.queue.delete(id);
      const item = this.records.get(id);
      if (!item || !item.visible || item.loading || item.thumb) continue;
      item.loading = true;
      this.activeDecodes++;
      const generation = item.generation;
      void this.decode(item).then(data => {
        if (!data || generation !== item.generation || !item.visible || !this.visible ||
            this.records.get(item.id) !== item) return;
        item.thumb = data.thumb;
        item.frames = data.frames;
        item.output = data.output;
        item.canvas.style.opacity = '1';
        item.lastIndex = -1;
        this.draw(item, 0);
        this.start();
      }).catch(() => {
        // Bad animation sprite: the regular static image remains visible.
      }).finally(() => {
        item.loading = false;
        this.activeDecodes--;
        if (item.visible && !item.thumb && generation !== item.generation) this.queue.add(item.id);
        this.pump();
      });
    }
  }

  private async decode(item: SlotAnimation): Promise<{
    thumb: HTMLCanvasElement; frames: Uint8ClampedArray[] | null; output: ImageData | null;
  } | null> {
    const sprite = await createImageBitmap(item.png);
    try {
      const sourceSize = sprite.width;
      if (sourceSize < 1 || sprite.height !== sourceSize * item.ticks.length) return null;
      const size = 48;
      const thumb = document.createElement('canvas');
      thumb.width = size;
      thumb.height = size * item.ticks.length;
      const context = thumb.getContext('2d', { willReadFrequently: item.interpolate });
      if (!context) return null;
      context.imageSmoothingEnabled = true;
      for (let frame = 0; frame < item.ticks.length; frame++) {
        context.drawImage(sprite, 0, frame * sourceSize, sourceSize, sourceSize,
          0, frame * size, size, size);
      }
      let frames: Uint8ClampedArray[] | null = null;
      let output: ImageData | null = null;
      if (item.interpolate) {
        frames = [];
        for (let i = 0; i < item.ticks.length; i++) {
          frames.push(context.getImageData(0, i * size, size, size).data);
        }
        output = item.canvas.getContext('2d')?.createImageData(size, size) ?? null;
      }
      return { thumb, frames, output };
    } finally {
      sprite.close();
    }
  }

  private start(): void {
    if (this.raf !== null || !this.visible || document.hidden) return;
    this.raf = requestAnimationFrame(this.paint);
  }

  private stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private readonly paint = (now: number): void => {
    this.raf = null;
    if (!this.visible || document.hidden) return;
    if (now - this.lastPaint >= 1000 / 60 - 1) {
      this.lastPaint = now;
      for (const item of this.records.values()) {
        if (item.visible && item.thumb) this.draw(item, now);
      }
    }
    if ([...this.records.values()].some(item => item.visible && item.thumb)) this.start();
  };

  private draw(item: SlotAnimation, now: number): void {
    if (!item.thumb) return;
    const context = item.canvas.getContext('2d');
    if (!context) return;
    const { index, next, blend } = spritePosition(item.ticks, item.speed, now);
    const size = item.canvas.width;
    if (item.interpolate && item.frames && item.output) {
      const current = item.frames[index], following = item.frames[next];
      const out = item.output.data;
      for (let i = 0; i < out.length; i++) {
        out[i] = current[i] + (following[i] - current[i]) * blend;
      }
      context.putImageData(item.output, 0, 0);
    } else if (item.lastIndex !== index) {
      context.clearRect(0, 0, size, size);
      context.imageSmoothingEnabled = false;
      context.drawImage(item.thumb, 0, index * size, size, size, 0, 0, size, size);
    }
    item.lastIndex = index;
  }
}
