/**
 * Runtime model for the 99 Nextbot slots.
 * Stage 01 keeps blobs in memory. IndexedDB persistence comes in stage 04.
 */
export const SLOT_COUNT = 99;

import type { VisualEffectSettings } from './visualEffects';

export type SlotStatus = 'empty' | 'partial' | 'complete';
export type SlotTransferMode = 'copy' | 'move' | 'swap';

export interface VisualAsset {
  readonly sourceName: string;
  readonly sourceFormat: 'png' | 'gif' | 'video';
  readonly source: Blob;
  /** Per-animation speed saved with the slot, 1 by default. Applied during asset ZIP export. */
  readonly animationSpeed?: number;
  /** Legacy flag retained for data saved before visual effect modes were added. */
  readonly gaming?: boolean;
  /** Rainbow direction/mode and optional enchantment-style glint. */
  readonly effects?: VisualEffectSettings;
  /** Null until a usable Minecraft texture is successfully prepared. */
  readonly processed: {
    /** Baked texture, may contain a vertical animation strip with visual effects. */
    readonly png: Blob;
    readonly animationMcmeta?: string;
    readonly previewPng?: Blob;
    /** Un-tinted, cropped/keyed still image for lightweight MOD pack export. */
    readonly basePng?: Blob;
  } | null;
}

export interface AudioAsset {
  readonly sourceName: string;
  readonly sourceFormat: 'ogg' | 'mp3' | 'video';
  readonly source: Blob;
  /** 0 = off, 100 = strongest hard-clipping effect. */
  readonly distortion?: number;
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

/** A name-only slot is also meaningful content during copy/move/swap. */
export function slotHasContent(slot: NextbotSlot): boolean {
  return slot.name.length > 0 || slot.visual !== null || slot.audio !== null;
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

  /** Copy, move, or swap complete slot payloads without changing their fixed IDs.
   * Blob references are safe to reuse: Blobs are immutable, and replacement edits
   * always create new asset objects rather than mutating shared data.
   */
  transfer(sourceId: number, targetId: number, mode: SlotTransferMode, allowOverwrite = false): void {
    assertSlotId(sourceId);
    assertSlotId(targetId);
    if (sourceId === targetId) throw new Error('同じスロットには操作できません。');
    if (mode !== 'copy' && mode !== 'move' && mode !== 'swap') throw new Error('操作の種類が不正です。');

    const source = this.slots[sourceId - 1];
    const target = this.slots[targetId - 1];
    if (!slotHasContent(source)) throw new Error('元のスロットにコピー・移動できるデータがありません。');
    if (mode !== 'swap' && slotHasContent(target) && !allowOverwrite) {
      throw new Error('移動先は使用中です。上書き確認が必要です。');
    }

    // All validation above happens before modifying either slot.
    this.slots[targetId - 1] = { ...source, id: targetId };
    if (mode === 'move') this.slots[sourceId - 1] = blankSlot(sourceId);
    if (mode === 'swap') this.slots[sourceId - 1] = { ...target, id: sourceId };
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
