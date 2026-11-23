import type { NextbotSlot } from './slots';

const DATABASE = 'runes-nextbot-maker';
const STORE = 'slots';
const VERSION = 1;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDBを開けません'));
    request.onblocked = () => reject(new Error('別タブでデータベースが使用中です'));
  });
}

export async function loadSlots(): Promise<NextbotSlot[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as NextbotSlot[]);
      request.onerror = () => reject(request.error ?? new Error('保存データを読めません'));
    });
  } finally {
    db.close();
  }
}

/** Persist the entire snapshot in one transaction, so deletion and updates remain consistent. */
export async function saveSlots(slots: readonly NextbotSlot[]): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const objectStore = tx.objectStore(STORE);
      objectStore.clear();
      for (const slot of slots) {
        if (slot.name || slot.visual || slot.audio) objectStore.put(slot);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('保存できません'));
      tx.onabort = () => reject(tx.error ?? new Error('保存が中断されました'));
    });
  } finally {
    db.close();
  }
}
