
import { NextbotSlotStore, SLOT_COUNT, slotStatus } from './slots';
import type { SlotStatus } from './slots';
import './inventory.css';

/** Custom CSS inspired by Minecraft's 9-column creative inventory. */
export function mountInventory(
  root: HTMLElement,
  store: NextbotSlotStore,
  onSelect: (id: number) => void,
): { render: (selectedId: number) => void } {
  root.innerHTML = [
    '<div class="nb-tabs"><span class="nb-tab nb-tab-active" aria-hidden="true">◈ NEXTBOTS</span></div>',
    '<div class="nb-panel">',
    '<div class="nb-panel-header"><span class="nb-panel-title">Nextbot 一覧</span>',
    '<span id="nb-inventory-count" class="nb-count">0 / 99</span></div>',
    '<div class="nb-frame"><div id="nb-scroll-area" class="nb-scroll-area" tabindex="0" aria-label="スクロールできるNextbot一覧">',
    '<div id="nb-grid" class="nb-grid" role="group" aria-label="99スロット"></div></div>',
    '<div class="nb-scroll-rail" aria-hidden="true"><div class="nb-scroll-thumb"></div></div></div>',
    '<div class="nb-legend"><span><i class="nb-dot nb-empty"></i>未設定</span>',
    '<span><i class="nb-dot nb-partial"></i>設定途中</span>',
    '<span><i class="nb-dot nb-complete"></i>素材準備完了</span></div>',
    '<div id="nb-selection-hint" class="nb-selection-hint" role="status" aria-live="polite"></div>',
    '</div>',
  ].join('');

  const grid = root.querySelector<HTMLDivElement>('#nb-grid');
  const scroll = root.querySelector<HTMLDivElement>('#nb-scroll-area');
  const thumb = root.querySelector<HTMLDivElement>('.nb-scroll-thumb');
  const count = root.querySelector<HTMLSpanElement>('#nb-inventory-count');
  const hint = root.querySelector<HTMLDivElement>('#nb-selection-hint');
  if (!grid || !scroll || !thumb || !count || !hint) throw new Error('Inventory UI unavailable');

  const buttons: HTMLButtonElement[] = [];
  const urls = new Map<number, { blob: Blob; url: string }>();

  for (let id = 1; id <= SLOT_COUNT; id++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nb-slot nb-slot-empty';
    button.dataset.id = String(id);
    button.addEventListener('click', () => onSelect(id));
    grid.append(button);
    buttons.push(button);
  }

  const statusNames: Record<SlotStatus, string> = {
    empty: '未設定', partial: '設定途中', complete: '素材準備完了',
  };

  function updateRail(): void {
    const contentHeight = scroll.scrollHeight;
    const viewHeight = scroll.clientHeight;
    const visibleFraction = contentHeight > 0 ? Math.min(1, viewHeight / contentHeight) : 1;
    const maxScroll = Math.max(0, contentHeight - viewHeight);
    const ratio = maxScroll > 0 ? scroll.scrollTop / maxScroll : 0;
    const height = Math.max(8, visibleFraction * 100);
    thumb.style.height = String(height) + '%';
    thumb.style.top = String(ratio * (100 - height)) + '%';
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
      const png = slot.visual?.processed?.png;
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
    updateRail();
  }

  requestAnimationFrame(updateRail);
  return { render };
}
