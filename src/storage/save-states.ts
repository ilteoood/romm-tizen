import type { SaveEntry, StateEntry } from "../api/romm";

const DB_NAME = "romm-tizen-save-states";
const DB_VERSION = 1;
const STORE_LISTS = "save_state_lists";

export type SaveStateList = {
  romId: number;
  saves: SaveEntry[];
  states: StateEntry[];
  fetchedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_LISTS)) {
          db.createObjectStore(STORE_LISTS, { keyPath: "romId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
  }
  return dbPromise;
}

function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function objectStore(db: IDBDatabase, name: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(name, mode).objectStore(name);
}

export async function getCachedSaveStateList(romId: number): Promise<SaveStateList | null> {
  const db = await openDb();
  const record = (await awaitRequest(objectStore(db, STORE_LISTS, "readonly").get(romId))) as
    | SaveStateList
    | undefined;
  return record ?? null;
}

export async function setCachedSaveStateList(list: SaveStateList): Promise<void> {
  const db = await openDb();
  await awaitRequest(objectStore(db, STORE_LISTS, "readwrite").put(list));
}

export async function evictSaveStateList(romId: number): Promise<void> {
  const db = await openDb();
  await awaitRequest(objectStore(db, STORE_LISTS, "readwrite").delete(romId));
}
