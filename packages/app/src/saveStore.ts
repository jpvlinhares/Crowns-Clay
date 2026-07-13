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

// ---------------------------------------------------------------- quota (roadmap M44; doc 11 §3/§4)

export interface StorageEstimate {
  readonly usageBytes: number;
  readonly quotaBytes: number;
}

/** `null` when the Storage API (or `estimate()`) isn't available — older browsers, or a worker
 * context without it — never throws; callers treat `null` as "can't tell, don't advise." */
export async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || navigator.storage?.estimate === undefined) return null;
  const { usage, quota } = await navigator.storage.estimate();
  if (usage === undefined || quota === undefined) return null;
  return { usageBytes: usage, quotaBytes: quota };
}

/** Best-effort request for durable (non-evictable) storage — browsers may grant or deny silently
 * per their own heuristics (engagement, install state); `false` covers both "denied" and
 * "unsupported," which callers don't need to tell apart (doc 11 §4 mitigation list). */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.storage?.persist === undefined) return false;
  return navigator.storage.persist();
}

/** Risk R6's tripwire, verbatim: "quota estimate <2× current footprint." Remaining headroom
 * (quota − usage) smaller than the footprint already consumed means growth has nowhere near
 * double left to go before eviction risk becomes real. */
export function isStorageTight(estimate: StorageEstimate): boolean {
  return estimate.quotaBytes < estimate.usageBytes * 2;
}

/** Pure predicate: which of `slots` fall outside a ring narrowed to `maxSlots` — numbered
 * autosave slots only (`autosave-N`), manual/named slots are never touched. Split out from
 * `pruneAutosaveRing` so the selection logic is unit-testable without a real IndexedDB. */
export function slotsToPrune(slots: readonly string[], maxSlots: number): string[] {
  return slots.filter((slot) => {
    const match = /^autosave-(\d+)$/.exec(slot);
    return match !== null && Number(match[1]) >= maxSlots;
  });
}

/** Shrinks the autosave ring to `maxSlots` by deleting any numbered slot at or beyond it — the
 * "managed ring" doc 11 §3 calls for, upgrading AUTOSAVE_RING's fixed round-robin overwrite into
 * one that actively narrows under real storage pressure instead of just holding steady at 3. */
export async function pruneAutosaveRing(maxSlots: number): Promise<void> {
  const doomed = slotsToPrune(await listSlots(), maxSlots);
  await Promise.all(doomed.map((slot) => deleteSlot(slot)));
}
