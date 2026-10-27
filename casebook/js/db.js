/* ==========================================================================
   MegaFauna Casebook: storage in this browser (IndexedDB)
   meta     the lock: PBKDF2 settings and the encrypted master key
   records  every record, encrypted ({ iv, ct }), keyed by its id
   chunks   evidence files in encrypted pieces, keyed "<file>:<number>"
   Nothing readable is ever written here.
   ========================================================================== */

const NAME = 'mwf-casebook';
const VERSION = 1;

let opening = null;

function open() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(NAME, VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of ['meta', 'records', 'chunks']) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab erasing the Casebook needs this one to let go.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('The Casebook is busy in another tab.'));
    });
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}

// Runs work(transaction) and resolves when the transaction has finished.
// work may return a request (its result is passed on) or a function that
// builds the result once everything is done.
async function run(stores, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode, { durability: 'strict' });
    const out = work(tx);
    tx.oncomplete = () => resolve(typeof out === 'function' ? out() : out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Saving was interrupted.'));
  });
}

const prefixRange = (prefix) => IDBKeyRange.bound(`${prefix}:`, `${prefix}:￿`);

export const supported = () => typeof indexedDB !== 'undefined';

export const getMeta = () => run(['meta'], 'readonly', (tx) => tx.objectStore('meta').get('vault'));

export const putMeta = (meta) => run(['meta'], 'readwrite', (tx) => {
  tx.objectStore('meta').put(meta, 'vault');
});

export const loadRecords = () => run(['records'], 'readonly', (tx) => {
  const store = tx.objectStore('records');
  const keys = store.getAllKeys();
  const values = store.getAll();
  return () => keys.result.map((id, i) => ({ id, box: values.result[i] }));
});

// Writes several records in one transaction: all of them are saved, or none.
export const putRecords = (entries) => run(['records'], 'readwrite', (tx) => {
  const store = tx.objectStore('records');
  for (const { id, box } of entries) store.put(box, id);
});

export const deleteRecords = (ids) => run(['records'], 'readwrite', (tx) => {
  const store = tx.objectStore('records');
  for (const id of ids) store.delete(id);
});

// The shape vault.js expects for evidence files.
export const chunkStore = {
  putChunk: (id, box) => run(['chunks'], 'readwrite', (tx) => {
    tx.objectStore('chunks').put(box, id);
  }),
  getChunk: (id) => run(['chunks'], 'readonly', (tx) => tx.objectStore('chunks').get(id)),
  countChunks: (name) => run(['chunks'], 'readonly', (tx) => tx.objectStore('chunks').count(prefixRange(name))),
  deleteChunks: (name) => run(['chunks'], 'readwrite', (tx) => {
    tx.objectStore('chunks').delete(prefixRange(name));
  }),
};

// The names of all stored files, to find pieces nothing refers to any more.
export const storedFileNames = () => run(['chunks'], 'readonly', (tx) => {
  const keys = tx.objectStore('chunks').getAllKeys();
  return () => new Set(keys.result.map((key) => String(key).split(':')[0]));
});

export async function destroy() {
  if (opening) {
    try {
      (await opening).close();
    } catch (err) {
      // It never opened; nothing to close.
    }
    opening = null;
  }
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
