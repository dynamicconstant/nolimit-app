/* Local storage for everything the app keeps: sessions, home-game results and hands.
   IndexedDB, with a one-object-per-store shape so backups are a single JSON file. */
"use strict";

const DB = (() => {
  const NAME = "nolimit", VERSION = 1;
  const STORES = ["sessions", "homegames", "homehands", "kv"];
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : r);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    id,
    put: (store, obj) => tx(store, "readwrite", (s) => s.put(obj)).then(() => obj),
    get: (store, key) => tx(store, "readonly", (s) => s.get(key)),
    del: (store, key) => tx(store, "readwrite", (s) => s.delete(key)),
    all: (store) => tx(store, "readonly", (s) => s.getAll()),
    clear: (store) => tx(store, "readwrite", (s) => s.clear()),
    async kvGet(k, dflt) { const r = await this.get("kv", k); return r ? r.value : dflt; },
    kvSet(k, value) { return this.put("kv", { id: k, value }); },
    async export() {
      const out = { app: "nolimit", exported: new Date().toISOString() };
      for (const s of STORES) out[s] = await this.all(s);
      return out;
    },
    async import(data, replace) {
      if (!data || data.app !== "nolimit") throw new Error("Not a No Limit backup file.");
      for (const s of STORES) {
        if (!Array.isArray(data[s])) continue;
        if (replace) await this.clear(s);
        for (const obj of data[s]) await this.put(s, obj);
      }
    },
  };
})();
window.DB = DB;
