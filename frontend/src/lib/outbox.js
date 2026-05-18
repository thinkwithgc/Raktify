// IndexedDB-backed outbox for write requests that should survive offline.
//
// Spec §7.6: donors can toggle availability while offline; the toggle must
// sync once the network returns. We don't reach for the `idb` npm package
// because the surface is small — a single object store keyed by autoinc id,
// FIFO replay on flush().
//
// Records:  { id, method, url, body, createdAt, lastError? }
// API:      enqueue(entry) → id; list() → entries; remove(id); count();
//           flush(sender) → { sent, failed }
//
// `sender` is a function that takes one stored entry and resolves on 2xx,
// rejects otherwise. On reject we keep the entry in the store and stop the
// flush — replay is strictly FIFO so a single failure pauses the queue.

const DB_NAME = 'raktify';
const DB_VERSION = 1;
const STORE = 'outbox';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    Promise.resolve(fn(store))
      .then((r) => {
        result = r;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue({ method, url, body }) {
  const entry = { method, url, body, createdAt: Date.now() };
  return withStore('readwrite', (store) => reqToPromise(store.add(entry)));
}

export async function list() {
  return withStore('readonly', (store) => reqToPromise(store.getAll()));
}

export async function count() {
  return withStore('readonly', (store) => reqToPromise(store.count()));
}

export async function remove(id) {
  return withStore('readwrite', (store) => reqToPromise(store.delete(id)));
}

export async function flush(sender) {
  let entries;
  try {
    entries = await list();
  } catch {
    return { sent: 0, failed: 0 };
  }
  let sent = 0;
  let failed = 0;
  // FIFO — list() returns entries in insertion order because the keyPath is
  // an autoincrement id.
  for (const entry of entries.sort((a, b) => a.id - b.id)) {
    try {
      await sender(entry);
      await remove(entry.id);
      sent += 1;
    } catch {
      // Stop on first failure so we don't reorder writes against the server.
      failed += 1;
      break;
    }
  }
  return { sent, failed };
}

export function isAvailable() {
  return typeof indexedDB !== 'undefined';
}
