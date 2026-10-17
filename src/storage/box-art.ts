const DB_NAME = "romm-tizen";
const DB_VERSION = 1;
const STORE_COVERS = "covers";
const STORE_COVERS_META = "covers_meta";
const COVERS_CACHE_LIMIT_BYTES = 256 * 1024 * 1024;

type CoverBlob = { romId: number; blob: Blob };
type CoverMeta = { romId: number; ts: string | null; size: number; lastAccess: number };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_COVERS)) {
          db.createObjectStore(STORE_COVERS, { keyPath: "romId" });
        }
        if (!db.objectStoreNames.contains(STORE_COVERS_META)) {
          db.createObjectStore(STORE_COVERS_META, { keyPath: "romId" });
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

function store(db: IDBDatabase, name: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(name, mode).objectStore(name);
}

async function evict(db: IDBDatabase, romId: number): Promise<void> {
  await Promise.all([
    awaitRequest(store(db, STORE_COVERS, "readwrite").delete(romId)),
    awaitRequest(store(db, STORE_COVERS_META, "readwrite").delete(romId)),
  ]);
}

async function enforceBudget(db: IDBDatabase): Promise<void> {
  const meta = (await awaitRequest(store(db, STORE_COVERS_META, "readonly").getAll())) as CoverMeta[];
  const totalSize = meta.reduce((sum, m) => sum + m.size, 0);
  if (totalSize <= COVERS_CACHE_LIMIT_BYTES) return;
  const sorted = [...meta].sort((a, b) => a.lastAccess - b.lastAccess);
  let running = totalSize;
  for (const entry of sorted) {
    if (running <= COVERS_CACHE_LIMIT_BYTES) return;
    await evict(db, entry.romId);
    running -= entry.size;
  }
}

export async function getCachedCover(romId: number, currentTs: string | null): Promise<Blob | null> {
  const db = await openDb();
  const meta = (await awaitRequest(store(db, STORE_COVERS_META, "readonly").get(romId))) as CoverMeta | undefined;
  if (!meta) return null;
  if (currentTs && meta.ts !== currentTs) {
    await evict(db, romId);
    return null;
  }
  const blobRecord = (await awaitRequest(store(db, STORE_COVERS, "readonly").get(romId))) as CoverBlob | undefined;
  if (!blobRecord) return null;
  meta.lastAccess = Date.now();
  await awaitRequest(store(db, STORE_COVERS_META, "readwrite").put(meta));
  return blobRecord.blob;
}

export async function storeCover(romId: number, ts: string | null, blob: Blob): Promise<void> {
  const db = await openDb();
  const blobRecord: CoverBlob = { romId, blob };
  const meta: CoverMeta = { romId, ts, size: blob.size, lastAccess: Date.now() };
  await awaitRequest(store(db, STORE_COVERS, "readwrite").put(blobRecord));
  await awaitRequest(store(db, STORE_COVERS_META, "readwrite").put(meta));
  await enforceBudget(db);
}

export function extractCoverTs(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  const match = relativePath.match(/[?&]ts=([^&]+)/);
  return match?.[1] ?? null;
}
