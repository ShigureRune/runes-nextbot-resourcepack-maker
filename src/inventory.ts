
import { NextbotSlotStore, SLOT_COUNT, slotStatus } from './slots';
import type { SlotStatus, SlotTransferMode } from './slots';
import { slotHasContent } from './slots';
import { scrollGeometry } from './scrollBounds';
import './inventory.css';

/** Custom CSS inspired by Minecraft's 9-column creative inventory. */
export function mountInventory(
  root: HTMLElement,
  store: NextbotSlotStore,
  onSelect: (id: number) => void,
  onModified: () => void,
): { render: (selectedId: number) => void } {
  root.innerHTML = [
    '<div class="nb-tabs"><span class="nb-tab nb-tab-active" aria-hidden="true">▣ NEXTBOTS</span></div>',
    '<div class="nb-panel">',
    '<div class="nb-panel-header"><span class="nb-panel-title">Nextbot 一覧</span>',
    '<span id="nb-inventory-count" class="nb-count">0 / 99</span></div>',
    '<div class="nb-tools" role="group" aria-label="スロットの整理">',
    '<button type="button" class="nb-tool-button" data-action="copy" aria-pressed="false">コピー</button>',
    '<button type="button" class="nb-tool-button" data-action="move" aria-pressed="false">移動</button>',
    '<button type="button" class="nb-tool-button" data-action="swap" aria-pressed="false">入れ替え</button>',
    '<button type="button" class="nb-tool-cancel" id="nb-cancel-transfer" hidden>キャンセル</button>',
    '</div>',
    '<p id="nb-operation-status" class="nb-operation-status" role="status" aria-live="polite">通常モード：タップで編集。整理するときは操作を選んでください。</p>',
    '<div class="nb-frame"><div id="nb-scroll-area" class="nb-scroll-area" tabindex="0" aria-label="スクロールできるNextbot一覧">',
    '<div id="nb-grid" class="nb-grid" role="group" aria-label="99スロット"></div></div>',
    '<div class="nb-scroll-rail" aria-hidden="true"><div class="nb-scroll-thumb"></div></div></div>',
    '<div class="nb-legend"><span><i class="nb-dot nb-empty"></i>未設定</span>',
    '<span><i class="nb-dot nb-partial"></i>設定途中</span>',
    '<span><i class="nb-dot nb-complete"></i>素材準備完了</span></div>',
    '<div id="nb-selection-hint" class="nb-selection-hint" role="status" aria-live="polite"></div>',
    '</div>',
  ].join('');

  function required<T extends Element>(selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Inventory element missing: ${selector}`);
    return element;
  }
  const grid = required<HTMLDivElement>('#nb-grid');
  const scroll = required<HTMLDivElement>('#nb-scroll-area');
  const thumb = required<HTMLDivElement>('.nb-scroll-thumb');
  const count = required<HTMLSpanElement>('#nb-inventory-count');
  const hint = required<HTMLDivElement>('#nb-selection-hint');
  const operationStatus = required<HTMLParagraphElement>('#nb-operation-status');
  const cancelButton = required<HTMLButtonElement>('#nb-cancel-transfer');
  const operationButtons = [...root.querySelectorAll<HTMLButtonElement>('.nb-tool-button')];
  let operation: SlotTransferMode | null = null;
  let sourceId: number | null = null;
  let renderedSelectedId = 1;

  function slotLabel(id: number): string { return 'Slot ' + String(id).padStart(2, '0'); }
  function operationLabel(mode: SlotTransferMode): string {
    return mode === 'copy' ? 'コピー' : mode === 'move' ? '移動' : '入れ替え';
  }

  function refreshOperationUi(): void {
    for (const button of operationButtons) {
      const active = button.dataset.action === operation;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('nb-tool-active', active);
    }
    cancelButton.hidden = operation === null;
    for (const button of buttons) {
      const activeSource = operation !== null && sourceId === Number(button.dataset.id);
      button.classList.toggle('nb-slot-source', activeSource);
    }
  }
  function beginOperation(next: SlotTransferMode): void {
    operation = next;
    sourceId = null;
    refreshOperationUi();
    operationStatus.textContent = operationLabel(next) + '：まず元になるスロットをタップしてください。';
  }
  function cancelOperation(): void {
    operation = null;
    sourceId = null;
    refreshOperationUi();
    operationStatus.textContent = '通常モードに戻りました。タップでスロットを編集できます。';
  }
  for (const button of operationButtons) {
    button.addEventListener('click', () => beginOperation(button.dataset.action as SlotTransferMode));
  }
  cancelButton.addEventListener('click', cancelOperation);

  function selectSlot(id: number): void {
    if (!operation) { onSelect(id); return; }
    if (sourceId === null) {
      if (!slotHasContent(store.get(id))) {
        operationStatus.textContent = slotLabel(id) + 'は空です。データの入った元スロットを選んでください。';
        return;
      }
      sourceId = id;
      refreshOperationUi();
      operationStatus.textContent = slotLabel(id) + 'を選択中。' + operationLabel(operation) +
        '先のスロットをタップしてください。変更する場合は操作ボタンを押し直せます。';
      return;
    }
    if (id === sourceId) {
      operationStatus.textContent = '元と先は同じ枠にできません。別のスロットを選んでください。';
      return;
    }
    const mode = operation;
    const fromId = sourceId;
    const occupied = slotHasContent(store.get(id));
    const label = operationLabel(mode);
    if (occupied && (mode === 'copy' || mode === 'move')) {
      if (!window.confirm(slotLabel(id) + 'には既存データがあります。\\n' +
        slotLabel(fromId) + 'から' + label + 'すると、' + slotLabel(id) + 'の名前・画像・音声が上書きされます。\\n本当に実行しますか？')) {
        operationStatus.textContent = '上書きをキャンセルしました。別のコピー・移動先も選べます。';
        return;
      }
    } else if (occupied && mode === 'swap') {
      if (!window.confirm(slotLabel(fromId) + ' と ' + slotLabel(id) +
        ' の名前・画像・音声を入れ替えますか？（データは消えません）')) {
        operationStatus.textContent = '入れ替えをキャンセルしました。';
        return;
      }
    }
    try {
      store.transfer(fromId, id, mode, occupied);
      operation = null;
      sourceId = null;
      onModified();
      refreshOperationUi();
      operationStatus.textContent = slotLabel(fromId) + ' → ' + slotLabel(id) + '：' + label + '完了。自動保存します。';
    } catch (error) {
      operationStatus.textContent = '操作失敗：' + (error instanceof Error ? error.message : 'スロットを確認してください。');
    }
  }

  const buttons: HTMLButtonElement[] = [];
  const urls = new Map<number, { blob: Blob; url: string }>();

  for (let id = 1; id <= SLOT_COUNT; id++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nb-slot nb-slot-empty';
    button.dataset.id = String(id);
    button.addEventListener('click', () => selectSlot(id));
    grid.append(button);
    buttons.push(button);
  }

  const statusNames: Record<SlotStatus, string> = {
    empty: '未設定', partial: '設定途中', complete: '素材準備完了',
  };

  function updateRail(): void {
    const geometry = scrollGeometry(scroll.scrollHeight, scroll.clientHeight, scroll.scrollTop);
    // iOS Safari can expose negative / beyond-end scrollTop during elastic overscroll.
    // Clamp the actual scroll position and keep the decorative thumb in its rail.
    if (Math.abs(scroll.scrollTop - geometry.clampedScrollTop) > 0.5) {
      scroll.scrollTop = geometry.clampedScrollTop;
    }
    thumb.style.height = String(geometry.heightPercent) + '%';
    thumb.style.top = String(geometry.topPercent) + '%';
  }

  function imageUrl(id: number, blob: Blob): string {
    const cached = urls.get(id);
    if (cached && cached.blob === blob) return cached.url;
    if (cached) URL.revokeObjectURL(cached.url);
    const url = URL.createObjectURL(blob);
    urls.set(id, { blob, url });
    return url;
  }

  scroll.addEventListener('scroll', updateRail, { passive: true });
  window.addEventListener('pagehide', () => {
    for (const record of urls.values()) URL.revokeObjectURL(record.url);
    urls.clear();
  });

  function render(selectedId: number): void {
    renderedSelectedId = selectedId;
    const data = store.list();
    const summary = store.summary();
    count.textContent = String(summary.complete) + ' / ' + String(SLOT_COUNT) + ' 完成';

    for (const slot of data) {
      const button = buttons[slot.id - 1];
      const state = slotStatus(slot);
      button.className = 'nb-slot nb-slot-' + state + (slot.id === selectedId ? ' nb-selected' : '');
      button.setAttribute('aria-pressed', String(slot.id === selectedId));
      button.setAttribute('aria-label', 'Slot ' + String(slot.id).padStart(2, '0') + '：' + statusNames[state] + (slot.name ? '、' + slot.name : ''));
      button.replaceChildren();
      const cached = urls.get(slot.id);
      const png = slot.visual?.processed?.previewPng ?? slot.visual?.processed?.png;
      if (!png && cached) {
        URL.revokeObjectURL(cached.url);
        urls.delete(slot.id);
      }

      if (state === 'complete' && png) {
        const image = document.createElement('img');
        image.src = imageUrl(slot.id, png);
        image.alt = '';
        image.className = 'nb-face';
        button.append(image);
        const check = document.createElement('span');
        check.className = 'nb-check';
        check.textContent = '✓';
        check.setAttribute('aria-hidden', 'true');
        button.append(check);
      } else {
        const number = document.createElement('span');
        number.className = 'nb-slot-number';
        number.textContent = String(slot.id).padStart(2, '0');
        button.append(number);
        if (state === 'partial') {
          const marker = document.createElement('span');
          marker.className = 'nb-partial-mark';
          marker.textContent = '!';
          marker.setAttribute('aria-hidden', 'true');
          button.append(marker);
        }
      }
    }

    const selected = store.get(selectedId);
    hint.textContent = '選択中：Slot ' + String(selectedId).padStart(2, '0') + '（' + statusNames[slotStatus(selected)] + '）';
    refreshOperationUi();
    updateRail();
  }

  requestAnimationFrame(updateRail);
  return { render };
}
