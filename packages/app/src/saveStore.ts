/**
 * IndexedDB slot store (roadmap M17; TDD §8; doc 05 §10). Runs in the SIM
 * WORKER — serialization and storage never stall the main thread. Zero
 * dependencies: a ~60-line promise wrapper is all the schema needs.
 *
 * Layout: one object store, key = slot name. Manual slots are player-named;
 * autosaves rotate through a fixed ring (pruned oldest-first by design, the
 * seed of the doc 11 quota strategy — full estimate()-based pruning at M44).
 */
export const AUTOSAVE_RING = 3;

/** Rotating autosave slot name for the n-th autosave. */
export function autosaveSlot(counter: number): string {
  return `autosave-${counter % AUTOSAVE_RING}`;
}

const DB_NAME = 'crowns-saves';
const STORE = 'slots';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

export async function putSlot(slot: string, payload: string): Promise<void> {
  await withStore('readwrite', (s) => s.put(payload, slot));
}

export async function getSlot(slot: string): Promise<string | undefined> {
  return withStore<string | undefined>('readonly', (s) => s.get(slot) as IDBRequest<string | undefined>);
}

export async function listSlots(): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
  return keys.map(String).sort();
}

export async function deleteSlot(slot: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(slot));
}
