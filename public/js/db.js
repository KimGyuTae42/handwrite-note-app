// ============ IndexedDB 저장소 ============
// folders / notes / templates / fonts / meta 5개 저장소를 사용합니다.

const DB_NAME = "handwriteNoteDB";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("folders")) db.createObjectStore("folders", { keyPath: "id" });
      if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("templates")) db.createObjectStore("templates", { keyPath: "id" });
      if (!db.objectStoreNames.contains("fonts")) db.createObjectStore("fonts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbPromise = openDB();

async function dbGetAll(store) {
  const db = await dbPromise;
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readonly");
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function dbGet(store, id) {
  const db = await dbPromise;
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readonly");
    const r = tx.objectStore(store).get(id);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function dbPut(store, val) {
  const db = await dbPromise;
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(val);
    tx.oncomplete = () => res(val);
    tx.onerror = () => rej(tx.error);
  });
}

async function dbDelete(store, id) {
  const db = await dbPromise;
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
