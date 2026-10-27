/* ==========================================================================
   MegaFauna Casebook: encryption
   Everything the Casebook stores is encrypted with AES-256-GCM before it
   reaches the browser's storage, and Casebook files sent between people are
   encrypted the same way.

   Keys
   - A random 256-bit master key is made when the Casebook is set up.
   - The passphrase is stretched with PBKDF2-SHA-256 (600,000 rounds) into a
     key that encrypts the master key. Only that encrypted copy is stored, so
     changing the passphrase never re-encrypts the records.
   - HKDF turns the master key into the key for records and evidence, and a
     separate HMAC key that names stored evidence files without revealing
     their fingerprints.
   - Every encrypted item carries "additional data" naming what it is and
     where it belongs, so stored items can't be swapped or reordered without
     decryption failing.

   Nothing here touches the page or the database: storage is passed in, so
   the same code runs in the tests.
   ========================================================================== */

import { Sha256, toHex } from './sha256.js';

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const utf8 = (text) => encoder.encode(text);

export const KDF_ITERATIONS = 600000;
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 10000000;
export const CHUNK_SIZE = 4 * 1024 * 1024;

const VAULT_FORMAT = 'mwf-casebook';
const FILE_FORMAT = 'mwf-casebook-file';
const MAGIC = utf8('MWFCASE1');
const MAX_HEADER = 4096;

export const FRAME = { manifest: 1, chunk: 2, end: 3 };

// code: what went wrong, for the page to explain in its own words.
export class CasebookError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'CasebookError';
    this.code = code;
  }
}

/* Bytes ------------------------------------------------------------------ */

export function randomBytes(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const asBytes = (value) => (value instanceof Uint8Array ? value : new Uint8Array(value));

function u32(n) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n);
  return bytes;
}

/* Keys ------------------------------------------------------------------- */

async function passphraseKey(passphrase, salt, iterations) {
  // NFC, so the same passphrase typed on two different keyboards still matches.
  const base = await subtle.importKey('raw', utf8(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function keysFromMaster(master) {
  const base = await subtle.importKey('raw', master, 'HKDF', false, ['deriveKey']);
  const hkdf = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8(info) });
  const [data, ids] = await Promise.all([
    subtle.deriveKey(hkdf('mwf-casebook records v1'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    subtle.deriveKey(hkdf('mwf-casebook file names v1'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
  ]);
  return { data, ids };
}

const MASTER_CONTEXT = 'master-key';

function checkIterations(n) {
  if (!Number.isInteger(n) || n < MIN_ITERATIONS || n > MAX_ITERATIONS) throw new CasebookError('damaged');
  return n;
}

async function wrapMaster(master, passphrase, iterations) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await passphraseKey(passphrase, salt, iterations);
  const data = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(MASTER_CONTEXT) }, key, master));
  return { kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, master: { iv, data } };
}

async function unwrapMaster(meta, passphrase) {
  if (!meta || meta.format !== VAULT_FORMAT || !meta.kdf || !meta.master) throw new CasebookError('damaged');
  const key = await passphraseKey(passphrase, asBytes(meta.kdf.salt), checkIterations(meta.kdf.iterations));
  try {
    return new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv: asBytes(meta.master.iv), additionalData: utf8(MASTER_CONTEXT) },
      key,
      asBytes(meta.master.data),
    ));
  } catch (err) {
    throw new CasebookError('wrong-passphrase');
  }
}

// Returns what to store (meta: no secrets in it) and the keys to keep in memory.
export async function createVault(passphrase, iterations = KDF_ITERATIONS) {
  const master = randomBytes(32);
  try {
    const wrapped = await wrapMaster(master, passphrase, iterations);
    const keys = await keysFromMaster(master);
    return { meta: Object.assign({ format: VAULT_FORMAT, version: 1, created: new Date().toISOString() }, wrapped), keys };
  } finally {
    master.fill(0);
  }
}

export async function unlockVault(meta, passphrase) {
  const master = await unwrapMaster(meta, passphrase);
  try {
    return await keysFromMaster(master);
  } finally {
    master.fill(0);
  }
}

// The master key stays the same, so the records don't need re-encrypting.
export async function changePassphrase(meta, oldPassphrase, newPassphrase, iterations = KDF_ITERATIONS) {
  const master = await unwrapMaster(meta, oldPassphrase);
  try {
    return Object.assign({}, meta, await wrapMaster(master, newPassphrase, iterations), { changed: new Date().toISOString() });
  } finally {
    master.fill(0);
  }
}

/* Records ---------------------------------------------------------------- */

async function seal(key, bytes, context) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(context) }, key, bytes));
  return { iv, ct };
}

async function unseal(key, box, context) {
  try {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: asBytes(box.iv), additionalData: utf8(context) }, key, asBytes(box.ct)));
  } catch (err) {
    throw new CasebookError('damaged');
  }
}

const recordContext = (id) => `record:${id}`;

export const sealRecord = (keys, record) => seal(keys.data, utf8(JSON.stringify(record)), recordContext(record.id));

export async function openRecord(keys, id, box) {
  return JSON.parse(decoder.decode(await unseal(keys.data, box, recordContext(id))));
}

/* Evidence files ----------------------------------------------------------
   A file is stored in encrypted 4 MB pieces named after an HMAC of its
   fingerprint, so the same file added twice is stored once, and the names in
   storage say nothing about the files.

   store: { putChunk(id, box), getChunk(id), deleteChunks(prefix), countChunks(prefix) }
*/

export const chunkCount = (size) => Math.max(1, Math.ceil(size / CHUNK_SIZE));
const chunkId = (name, index) => `${name}:${String(index).padStart(6, '0')}`;
const chunkContext = (name, index, total) => `chunk:${name}:${index}:${total}`;

export async function fileName(keys, sha256) {
  const mac = new Uint8Array(await subtle.sign('HMAC', keys.ids, utf8(`file:${sha256}`)));
  return toHex(mac.subarray(0, 16));
}

export async function hasFile(keys, store, file) {
  const name = await fileName(keys, file.sha256);
  return (await store.countChunks(name)) === chunkCount(file.size);
}

// Stores one piece of a file. name: from fileName(), passed in so a long
// file doesn't recompute it for every piece.
export async function storeFileChunk(keys, store, file, index, bytes, name) {
  const total = chunkCount(file.size);
  await store.putChunk(chunkId(name, index), await seal(keys.data, bytes, chunkContext(name, index, total)));
}

// Saves a file whose fingerprint is already known, checking it again on the
// way in, so a file that changed after it was fingerprinted is refused.
export async function saveFile(keys, store, blob, sha256, onProgress) {
  const name = await fileName(keys, sha256);
  const file = { sha256, size: blob.size };
  const total = chunkCount(blob.size);
  const hash = new Sha256();
  try {
    for (let i = 0; i < total; i++) {
      const bytes = new Uint8Array(await blob.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).arrayBuffer());
      hash.update(bytes);
      await storeFileChunk(keys, store, file, i, bytes, name);
      if (onProgress) onProgress(Math.min(blob.size, (i + 1) * CHUNK_SIZE), blob.size);
    }
  } catch (err) {
    await store.deleteChunks(name);
    throw err;
  }
  if (toHex(hash.digest()) !== sha256) {
    await store.deleteChunks(name);
    throw new CasebookError('changed-file');
  }
  return name;
}

// Hands back the file one decrypted piece at a time.
export async function readFileChunk(keys, store, file, index, name) {
  const total = chunkCount(file.size);
  const id = name || await fileName(keys, file.sha256);
  const box = await store.getChunk(chunkId(id, index));
  if (!box) throw new CasebookError('missing-file');
  return unseal(keys.data, box, chunkContext(id, index, total));
}

export async function loadFile(keys, store, file, onProgress) {
  const name = await fileName(keys, file.sha256);
  const total = chunkCount(file.size);
  const parts = [];
  for (let i = 0; i < total; i++) {
    parts.push(await readFileChunk(keys, store, file, i, name));
    if (onProgress) onProgress(Math.min(file.size, (i + 1) * CHUNK_SIZE), file.size);
  }
  return new Blob(parts, { type: file.mime || 'application/octet-stream' });
}

// Decrypts the stored file and fingerprints it again.
export async function checkFile(keys, store, file, onProgress) {
  const name = await fileName(keys, file.sha256);
  const total = chunkCount(file.size);
  const hash = new Sha256();
  let size = 0;
  for (let i = 0; i < total; i++) {
    let bytes;
    try {
      bytes = await readFileChunk(keys, store, file, i, name);
    } catch (err) {
      return { ok: false, problem: err.code === 'missing-file' ? 'missing' : 'damaged' };
    }
    hash.update(bytes);
    size += bytes.length;
    if (onProgress) onProgress(Math.min(file.size, (i + 1) * CHUNK_SIZE), file.size);
  }
  const actual = toHex(hash.digest());
  if (actual !== file.sha256 || size !== file.size) return { ok: false, problem: 'different', actual };
  return { ok: true, actual };
}

export async function deleteFile(keys, store, sha256) {
  await store.deleteChunks(await fileName(keys, sha256));
}

/* Casebook files ----------------------------------------------------------
   How cases travel between people: one encrypted file, opened with a
   passphrase agreed separately.

     "MWFCASE1"  | header length (4 bytes) | header (JSON)
     then frames: type (1) | iv (12) | length (4) | AES-GCM ciphertext

   The header holds only the PBKDF2 salt and rounds and a random file id.
   Frame 0 is the manifest (records and the list of files), then each file's
   pieces in order, then an end frame. Each frame's additional data is the
   file id, its position and its type, so frames can't be reordered, dropped,
   or mixed in from another file, and a cut-short file is noticed.
*/

const frameContext = (fileId, index, type) => `${fileId}|${index}|${type}`;

export async function writeCasefile({ passphrase, manifest, readChunk, onProgress, iterations = KDF_ITERATIONS }) {
  const salt = randomBytes(16);
  const fileId = toBase64(randomBytes(16));
  const header = utf8(JSON.stringify({
    format: FILE_FORMAT,
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    id: fileId,
  }));
  const key = await passphraseKey(passphrase, salt, iterations);
  const parts = [MAGIC, u32(header.length), header];
  let index = 0;

  async function frame(type, bytes) {
    const iv = randomBytes(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(frameContext(fileId, index, type)) }, key, bytes));
    // Wrapping each piece in a Blob lets the browser keep large exports out
    // of the page's memory.
    parts.push(new Blob([Uint8Array.of(type), iv, u32(ct.length), ct]));
    index++;
  }

  const files = manifest.files || [];
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let done = 0;
  await frame(FRAME.manifest, utf8(JSON.stringify(manifest)));
  for (const file of files) {
    const total = chunkCount(file.size);
    for (let i = 0; i < total; i++) {
      const bytes = await readChunk(file, i);
      await frame(FRAME.chunk, bytes);
      done += bytes.length;
      if (onProgress) onProgress(done, totalBytes);
    }
  }
  await frame(FRAME.end, utf8(JSON.stringify({ frames: index + 1 })));
  return new Blob(parts, { type: 'application/octet-stream' });
}

async function readBytes(blob, start, length) {
  if (start + length > blob.size) throw new CasebookError('damaged');
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

export async function readCasefileHeader(blob) {
  if (blob.size < 12) throw new CasebookError('not-casefile');
  const start = await readBytes(blob, 0, 12);
  if (MAGIC.some((b, i) => start[i] !== b)) throw new CasebookError('not-casefile');
  const length = new DataView(start.buffer).getUint32(8);
  if (length < 2 || length > MAX_HEADER) throw new CasebookError('damaged');
  let header;
  try {
    header = JSON.parse(decoder.decode(await readBytes(blob, 12, length)));
  } catch (err) {
    throw new CasebookError('damaged');
  }
  if (!header || header.format !== FILE_FORMAT) throw new CasebookError('not-casefile');
  if (header.version !== 1) throw new CasebookError('newer-version');
  if (!header.kdf || header.kdf.name !== 'PBKDF2' || header.kdf.hash !== 'SHA-256' || typeof header.kdf.salt !== 'string' || typeof header.id !== 'string') {
    throw new CasebookError('damaged');
  }
  checkIterations(header.kdf.iterations);
  return { header, offset: 12 + length };
}

async function readFrameHead(blob, offset) {
  const head = await readBytes(blob, offset, 17);
  const length = new DataView(head.buffer).getUint32(13);
  if (offset + 17 + length > blob.size) throw new CasebookError('damaged');
  return { type: head[0], iv: head.subarray(1, 13), length, body: offset + 17, next: offset + 17 + length };
}

async function decryptFrame(blob, key, fileId, index, head) {
  const ct = await readBytes(blob, head.body, head.length);
  try {
    return new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv: head.iv, additionalData: utf8(frameContext(fileId, index, head.type)) },
      key,
      ct,
    ));
  } catch (err) {
    throw new CasebookError('damaged');
  }
}

// Unlocks a Casebook file and reads its manifest. A wrong passphrase and a
// damaged first frame look the same to AES-GCM, so both report the passphrase.
export async function openCasefile(blob, passphrase) {
  const { header, offset } = await readCasefileHeader(blob);
  const key = await passphraseKey(passphrase, fromBase64(header.kdf.salt), header.kdf.iterations);
  const head = await readFrameHead(blob, offset);
  if (head.type !== FRAME.manifest) throw new CasebookError('damaged');
  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(await decryptFrame(blob, key, header.id, 0, head)));
  } catch (err) {
    throw new CasebookError('wrong-passphrase');
  }
  if (!manifest || typeof manifest !== 'object') throw new CasebookError('damaged');
  return { header, manifest, key, next: head.next };
}

// Walks the frames after the manifest. Each piece of each file in the
// manifest is passed to onChunk(file, index, read) in order, where read()
// decrypts it; pieces that aren't read are skipped unopened. Throws if the
// file is cut short, has extra frames, or anything fails to decrypt.
export async function readCasefileFiles(blob, opened, onChunk) {
  const { header, key } = opened;
  const files = Array.isArray(opened.manifest.files) ? opened.manifest.files : [];
  let offset = opened.next;
  let index = 1;
  for (const file of files) {
    const total = chunkCount(file.size);
    for (let i = 0; i < total; i++) {
      const head = await readFrameHead(blob, offset);
      if (head.type !== FRAME.chunk) throw new CasebookError('damaged');
      const frameIndex = index;
      await onChunk(file, i, () => decryptFrame(blob, key, header.id, frameIndex, head));
      offset = head.next;
      index++;
    }
  }
  const head = await readFrameHead(blob, offset);
  if (head.type !== FRAME.end) throw new CasebookError('damaged');
  const end = JSON.parse(decoder.decode(await decryptFrame(blob, key, header.id, index, head)));
  if (!end || end.frames !== index + 1 || head.next !== blob.size) throw new CasebookError('damaged');
}
