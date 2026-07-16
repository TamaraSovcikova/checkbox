// IndexedDB mutation queue for offline support.
// Mutations that fail due to network are queued here and replayed on reconnect.

const DB_NAME = "checkbox-offline";
const STORE = "queue";

interface QueueEntry {
  id?: number;
  method: string;
  url: string;
  body: string | null;
  ts: number;
}

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOffline(
  method: string,
  url: string,
  body?: unknown
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const entry: QueueEntry = {
      method,
      url,
      body: body !== undefined ? JSON.stringify(body) : null,
      ts: Date.now(),
    };
    tx.objectStore(STORE).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function replayOfflineQueue(
  onProgress?: () => void
): Promise<number> {
  const db = await openDB();
  const items = await new Promise<Required<QueueEntry>[]>((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Required<QueueEntry>[]);
    req.onerror = () => reject(req.error);
  });

  let replayed = 0;
  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.body ? { "content-type": "application/json" } : {},
        body: item.body ?? undefined,
      });
      // Remove from queue whether success or 4xx (don't retry client errors)
      if (res.ok || res.status < 500) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(item.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        if (res.ok) {
          replayed++;
          onProgress?.();
        }
      }
    } catch {
      break; // still offline - stop replaying
    }
  }
  return replayed;
}

export async function getOfflineQueueLength(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}
