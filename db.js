/* db.js — thin IndexedDB wrapper. No external dependencies, no server. */

const DB_NAME = 'markieStarIntelligence';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('topics')) {
        const topics = db.createObjectStore('topics', { keyPath: 'id', autoIncrement: true });
        topics.createIndex('status', 'status', { unique: false });
        topics.createIndex('category', 'category', { unique: false });
        topics.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('videos')) {
        const videos = db.createObjectStore('videos', { keyPath: 'id', autoIncrement: true });
        videos.createIndex('category', 'category', { unique: false });
        videos.createIndex('publishDate', 'publishDate', { unique: false });
        videos.createIndex('topicId', 'topicId', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrapRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  // Generic CRUD -----------------------------------------------------
  async add(store, obj) {
    const s = await tx(store, 'readwrite');
    return wrapRequest(s.add(obj));
  },
  async put(store, obj) {
    const s = await tx(store, 'readwrite');
    return wrapRequest(s.put(obj));
  },
  async get(store, key) {
    const s = await tx(store, 'readonly');
    return wrapRequest(s.get(key));
  },
  async getAll(store) {
    const s = await tx(store, 'readonly');
    return wrapRequest(s.getAll());
  },
  async delete(store, key) {
    const s = await tx(store, 'readwrite');
    return wrapRequest(s.delete(key));
  },
  async clear(store) {
    const s = await tx(store, 'readwrite');
    return wrapRequest(s.clear());
  },

  // Settings convenience ----------------------------------------------
  async getSetting(key, fallback = null) {
    const row = await DB.get('settings', key);
    return row ? row.value : fallback;
  },
  async setSetting(key, value) {
    return DB.put('settings', { key, value });
  },

  // Bulk import/export -------------------------------------------------
  async exportAll() {
    const [topics, videos, settingsRaw] = await Promise.all([
      DB.getAll('topics'),
      DB.getAll('videos'),
      DB.getAll('settings'),
    ]);
    return {
      meta: {
        app: 'Markie Star Intelligence',
        exportedAt: new Date().toISOString(),
        version: DB_VERSION,
      },
      topics,
      videos,
      settings: settingsRaw,
    };
  },

  async importAll(payload, mode = 'merge') {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Import file is not a valid Markie Star Intelligence export.');
    }
    const topics = Array.isArray(payload.topics) ? payload.topics : [];
    const videos = Array.isArray(payload.videos) ? payload.videos : [];
    const settings = Array.isArray(payload.settings) ? payload.settings : [];

    if (mode === 'replace') {
      await Promise.all([DB.clear('topics'), DB.clear('videos'), DB.clear('settings')]);
    }

    for (const t of topics) {
      if (mode === 'replace') {
        await DB.put('topics', t);
      } else {
        const clone = { ...t };
        delete clone.id;
        await DB.add('topics', clone);
      }
    }
    for (const v of videos) {
      if (mode === 'replace') {
        await DB.put('videos', v);
      } else {
        const clone = { ...v };
        delete clone.id;
        await DB.add('videos', clone);
      }
    }
    for (const s of settings) {
      await DB.put('settings', s);
    }

    return { topicsImported: topics.length, videosImported: videos.length };
  },

  async wipeAll() {
    await Promise.all([DB.clear('topics'), DB.clear('videos'), DB.clear('settings')]);
  },
};

window.DB = DB;
window.openDB = openDB;
