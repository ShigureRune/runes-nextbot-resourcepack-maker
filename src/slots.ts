/**
 * Runtime model for the 99 Nextbot slots.
 * Stage 01 keeps blobs in memory. IndexedDB persistence comes in stage 04.
 */
export const SLOT_COUNT = 99;

export type SlotStatus = 'empty' | 'partial' | 'complete';

export interface VisualAsset {
  readonly sourceName: string;
  readonly sourceFormat: 'png' | 'gif' | 'video';
  readonly source: Blob;
  /** Null until a usable Minecraft texture is successfully prepared. */
  readonly processed: { readonly png: Blob; readonly animationMcmeta?: string; readonly previewPng?: Blob } | null;
}

export interface AudioAsset {
  readonly sourceName: string;
  readonly sourceFormat: 'ogg' | 'mp3' | 'video';
  readonly source: Blob;
  /** Null until an OGG Vorbis sound is successfully prepared. */
  readonly processed: { readonly ogg: Blob } | null;
}

export interface NextbotSlot {
  readonly id: number;
  readonly name: string;
  readonly visual: VisualAsset | null;
  readonly audio: AudioAsset | null;
}

export interface SlotSummary {
  readonly empty: number;
  readonly partial: number;
  readonly complete: number;
  readonly partialIds: readonly number[];
  readonly completeIds: readonly number[];
  readonly canExport: boolean;
}

export function slotStatus(slot: NextbotSlot): SlotStatus {
  if (!slot.visual && !slot.audio) return 'empty';
  const imageReady = (slot.visual?.processed?.png.size ?? 0) > 0;
  const audioReady = (slot.audio?.processed?.ogg.size ?? 0) > 0;
  return imageReady && audioReady ? 'complete' : 'partial';
}

function assertSlotId(id: number): void {
  if (!Number.isInteger(id) || id < 1 || id > SLOT_COUNT) {
    throw new RangeError(`Slot must be an integer from 1 to ${SLOT_COUNT}: ${id}`);
  }
}

function blankSlot(id: number): NextbotSlot {
  return { id, name: '', visual: null, audio: null };
}

export class NextbotSlotStore {
  private readonly slots: NextbotSlot[] = Array.from(
    { length: SLOT_COUNT },
    (_, index) => blankSlot(index + 1),
  );

  get(id: number): NextbotSlot {
    assertSlotId(id);
    return { ...this.slots[id - 1] };
  }

  list(): NextbotSlot[] {
    return this.slots.map((slot) => ({ ...slot }));
  }

  update(
    id: number,
    changes: Partial<Pick<NextbotSlot, 'name' | 'visual' | 'audio'>>,
  ): NextbotSlot {
    assertSlotId(id);
    const next = { ...this.slots[id - 1], ...changes, id };
    this.slots[id - 1] = next;
    return { ...next };
  }

  clear(id: number): void {
    assertSlotId(id);
    this.slots[id - 1] = blankSlot(id);
  }

  summary(): SlotSummary {
    const partialIds: number[] = [];
    const completeIds: number[] = [];
    for (const slot of this.slots) {
      switch (slotStatus(slot)) {
        case 'complete':
          completeIds.push(slot.id);
          break;
        case 'partial':
          partialIds.push(slot.id);
          break;
      }
    }
    return {
      complete: completeIds.length,
      partial: partialIds.length,
      empty: SLOT_COUNT - completeIds.length - partialIds.length,
      completeIds,
      partialIds,
      canExport: completeIds.length > 0 && partialIds.length === 0,
    };
  }
}
