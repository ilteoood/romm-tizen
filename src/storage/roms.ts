const DB_NAME = "romm-tizen-roms";
const DB_VERSION = 1;
const STORE_ROMS = "roms";
const STORE_MANIFEST = "manifest";

export const ROM_CACHE_BUDGET_BYTES = 1.5 * 1024 * 1024 * 1024;

type RomBlob = { romId: number; blob: Blob };

export type RomMetadata = {
  romId: number;
  fsName: string;
  ext: string;
  size: number;
  updatedAt: string;
  crcHash: string | null;
  lastAccess: number;
};

export interface RomsStorage {
  save(romId: number, blob: Blob, metadata: Omit<RomMetadata, "lastAccess">): Promise<void>;
  get(romId: number): Promise<Blob | null>;
  metadata(romId: number): Promise<RomMetadata | null>;
  list(): Promise<RomMetadata[]>;
  evict(romId: number): Promise<void>;
  evictAll(): Promise<void>;
  enforceBudget(maxBytes: number): Promise<void>;
  touch(romId: number): Promise<void>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_ROMS)) {
          db.createObjectStore(STORE_ROMS, { keyPath: "romId" });
        }
        if (!db.objectStoreNames.contains(STORE_MANIFEST)) {
          db.createObjectStore(STORE_MANIFEST, { keyPath: "romId" });
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

async function evict(db: IDBDatabase, romId: number): Promise<void> {
  await Promise.all([
    awaitRequest(objectStore(db, STORE_ROMS, "readwrite").delete(romId)),
    awaitRequest(objectStore(db, STORE_MANIFEST, "readwrite").delete(romId)),
  ]);
}

async function enforceBudgetInternal(db: IDBDatabase, maxBytes: number): Promise<void> {
  const all = (await awaitRequest(objectStore(db, STORE_MANIFEST, "readonly").getAll())) as RomMetadata[];
  let total = all.reduce((sum, m) => sum + m.size, 0);
  if (total <= maxBytes) return;
  const sorted = [...all].sort((a, b) => a.lastAccess - b.lastAccess);
  for (const entry of sorted) {
    if (total <= maxBytes) return;
    await evict(db, entry.romId);
    total -= entry.size;
  }
}

export const romsStorage: RomsStorage = {
  async save(romId, blob, metadata) {
    const db = await openDb();
    const blobRecord: RomBlob = { romId, blob };
    const meta: RomMetadata = { ...metadata, romId, lastAccess: Date.now() };
    await awaitRequest(objectStore(db, STORE_ROMS, "readwrite").put(blobRecord));
    await awaitRequest(objectStore(db, STORE_MANIFEST, "readwrite").put(meta));
    await enforceBudgetInternal(db, ROM_CACHE_BUDGET_BYTES);
  },

  async get(romId) {
    const db = await openDb();
    const record = (await awaitRequest(objectStore(db, STORE_ROMS, "readonly").get(romId))) as RomBlob | undefined;
    if (!record) return null;
    const meta = (await awaitRequest(objectStore(db, STORE_MANIFEST, "readonly").get(romId))) as RomMetadata | undefined;
    if (meta) {
      meta.lastAccess = Date.now();
      await awaitRequest(objectStore(db, STORE_MANIFEST, "readwrite").put(meta));
    }
    return record.blob;
  },

  async metadata(romId) {
    const db = await openDb();
    const meta = (await awaitRequest(objectStore(db, STORE_MANIFEST, "readonly").get(romId))) as RomMetadata | undefined;
    return meta ?? null;
  },

  async list() {
    const db = await openDb();
    return (await awaitRequest(objectStore(db, STORE_MANIFEST, "readonly").getAll())) as RomMetadata[];
  },

  async evict(romId) {
    const db = await openDb();
    await evict(db, romId);
  },

  async evictAll() {
    const db = await openDb();
    const all = (await awaitRequest(objectStore(db, STORE_MANIFEST, "readonly").getAll())) as RomMetadata[];
    for (const entry of all) {
      await evict(db, entry.romId);
    }
  },

  async enforceBudget(maxBytes) {
    const db = await openDb();
    await enforceBudgetInternal(db, maxBytes);
  },

  async touch(romId) {
    const db = await openDb();
    const meta = (await awaitRequest(objectStore(db, STORE_MANIFEST, "readonly").get(romId))) as RomMetadata | undefined;
    if (!meta) return;
    meta.lastAccess = Date.now();
    await awaitRequest(objectStore(db, STORE_MANIFEST, "readwrite").put(meta));
  },
};
