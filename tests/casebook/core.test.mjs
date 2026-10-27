// Tests for the Casebook's encryption, file format, merging and activity log.
// Run from the repository root with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes as nodeRandom } from 'node:crypto';

import { Sha256, toHex, sha256Hex, fingerprintBlob } from '../../casebook/js/sha256.js';
import {
  CHUNK_SIZE, createVault, unlockVault, changePassphrase, sealRecord, openRecord,
  fileName, saveFile, loadFile, checkFile, hasFile, deleteFile,
  writeCasefile, openCasefile, readCasefileFiles, readCasefileHeader, readFileChunk,
} from '../../casebook/js/vault.js';
import {
  clean, cleanSettings, planMerge, selectForExport, cleanFileList, makeLogEntry, verifyLog,
  checklist, newId, wins, canonical,
} from '../../casebook/js/model.js';

const ITERATIONS = 100000; // the lowest the Casebook accepts; keeps the tests quick
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const random = (n) => new Uint8Array(nodeRandom(n));

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

function memoryStore() {
  const chunks = new Map();
  const inRange = (key, name) => key.startsWith(`${name}:`);
  return {
    chunks,
    async putChunk(id, box) { chunks.set(id, box); },
    async getChunk(id) { return chunks.get(id); },
    async countChunks(name) { return [...chunks.keys()].filter((k) => inRange(k, name)).length; },
    async deleteChunks(name) { for (const k of [...chunks.keys()]) if (inRange(k, name)) chunks.delete(k); },
  };
}

/* SHA-256 ---------------------------------------------------------------- */

test('sha256 matches known answers', () => {
  assert.equal(sha256Hex(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const million = new Uint8Array(1000000).fill(0x61);
  assert.equal(sha256Hex(million), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('sha256 gives the same answer however the data is split', async () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1000, 70000]) {
    const data = random(n);
    const hash = new Sha256();
    for (let i = 0; i < n;) {
      const step = 1 + ((i * 7919) % 97);
      hash.update(data.subarray(i, i + step));
      i += step;
    }
    assert.equal(toHex(hash.digest()), sha(data), `length ${n}`);
  }
  const data = random(3 * 1024 * 1024 + 11);
  assert.equal(await fingerprintBlob(new Blob([data]), null, 1024 * 1024), sha(data));
});

/* The vault -------------------------------------------------------------- */

test('a vault opens with its passphrase and no other', async () => {
  const { meta, keys } = await createVault('correct horse battery', ITERATIONS);
  assert.ok(meta.kdf.salt instanceof Uint8Array && meta.kdf.salt.length === 16);
  assert.equal(meta.kdf.iterations, ITERATIONS);
  const record = { id: newId(), kind: 'case', title: 'Poisoning near the market' };
  const box = await sealRecord(keys, record);
  assert.ok(!new TextDecoder().decode(box.ct).includes('Poisoning'));

  const again = await unlockVault(meta, 'correct horse battery');
  assert.deepEqual(await openRecord(again, record.id, box), record);
  await rejectsWith(unlockVault(meta, 'correct horse batterY'), 'wrong-passphrase');
});

test('a passphrase written in a different Unicode form still opens the vault', async () => {
  const composed = 'café måne';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed);
  const { meta } = await createVault(composed, ITERATIONS);
  await unlockVault(meta, decomposed);
});

test('changing the passphrase keeps every record readable', async () => {
  const { meta, keys } = await createVault('first passphrase', ITERATIONS);
  const record = { id: newId(), kind: 'case', title: 'x' };
  const box = await sealRecord(keys, record);
  const next = await changePassphrase(meta, 'first passphrase', 'second passphrase', ITERATIONS);
  await rejectsWith(unlockVault(next, 'first passphrase'), 'wrong-passphrase');
  const keys2 = await unlockVault(next, 'second passphrase');
  assert.deepEqual(await openRecord(keys2, record.id, box), record);
  await rejectsWith(changePassphrase(meta, 'not it', 'third', ITERATIONS), 'wrong-passphrase');
});

test('records cannot be swapped or altered', async () => {
  const { keys } = await createVault('pass phrase here', ITERATIONS);
  const a = { id: newId(), kind: 'case', title: 'A' };
  const b = { id: newId(), kind: 'case', title: 'B' };
  const boxA = await sealRecord(keys, a);
  await rejectsWith(openRecord(keys, b.id, boxA), 'damaged');
  const flipped = { iv: boxA.iv, ct: boxA.ct.slice() };
  flipped.ct[3] ^= 1;
  await rejectsWith(openRecord(keys, a.id, flipped), 'damaged');
});

test('a vault with weakened or broken settings is refused', async () => {
  const { meta } = await createVault('pass phrase here', ITERATIONS);
  await rejectsWith(unlockVault({ ...meta, kdf: { ...meta.kdf, iterations: 1000 } }, 'pass phrase here'), 'damaged');
  await rejectsWith(unlockVault({ ...meta, format: 'other' }, 'pass phrase here'), 'damaged');
});

/* Evidence files --------------------------------------------------------- */

test('evidence files are stored in encrypted pieces and come back intact', async () => {
  const { keys } = await createVault('pass phrase here', ITERATIONS);
  const store = memoryStore();
  const data = random(2 * CHUNK_SIZE + 12345);
  const file = { sha256: sha(data), size: data.length, mime: 'video/mp4' };

  const name = await saveFile(keys, store, new Blob([data]), file.sha256);
  assert.equal(store.chunks.size, 3);
  assert.ok(!name.includes(file.sha256.slice(0, 8)), 'stored names do not reveal fingerprints');
  const sizes = [...store.chunks.keys()].sort().map((key) => store.chunks.get(key).ct.length);
  assert.deepEqual(sizes, [CHUNK_SIZE + 16, CHUNK_SIZE + 16, 12345 + 16], 'each piece is its data plus a 16-byte tag');
  assert.ok(await hasFile(keys, store, file));

  const back = await loadFile(keys, store, file);
  assert.equal(back.type, 'video/mp4');
  assert.equal(sha(new Uint8Array(await back.arrayBuffer())), file.sha256);
  assert.deepEqual(await checkFile(keys, store, file), { ok: true, actual: file.sha256 });

  // The same file again is stored once.
  await saveFile(keys, store, new Blob([data]), file.sha256);
  assert.equal(store.chunks.size, 3);

  await deleteFile(keys, store, file.sha256);
  assert.equal(store.chunks.size, 0);
  assert.equal(await hasFile(keys, store, file), false);
});

test('damaged, missing or reordered pieces are caught', async () => {
  const { keys } = await createVault('pass phrase here', ITERATIONS);
  const store = memoryStore();
  const data = random(CHUNK_SIZE + 10);
  const file = { sha256: sha(data), size: data.length };
  await saveFile(keys, store, new Blob([data]), file.sha256);
  const [first, second] = [...store.chunks.keys()].sort();
  const boxes = { first: store.chunks.get(first), second: store.chunks.get(second) };

  boxes.first.ct[0] ^= 1;
  assert.equal((await checkFile(keys, store, file)).problem, 'damaged');
  boxes.first.ct[0] ^= 1;

  store.chunks.set(first, boxes.second);
  store.chunks.set(second, boxes.first);
  assert.equal((await checkFile(keys, store, file)).problem, 'damaged');
  store.chunks.set(first, boxes.first);
  store.chunks.set(second, boxes.second);

  store.chunks.delete(second);
  assert.equal((await checkFile(keys, store, file)).problem, 'missing');
  await rejectsWith(readFileChunk(keys, store, file, 1), 'missing-file');
});

test('a file that does not match its fingerprint is refused and cleaned up', async () => {
  const { keys } = await createVault('pass phrase here', ITERATIONS);
  const store = memoryStore();
  const data = random(5000);
  await rejectsWith(saveFile(keys, store, new Blob([data]), sha(random(10))), 'changed-file');
  assert.equal(store.chunks.size, 0);
});

test('two vaults store the same file under different names', async () => {
  const one = await createVault('pass phrase one', ITERATIONS);
  const two = await createVault('pass phrase two', ITERATIONS);
  const hash = sha(random(100));
  assert.notEqual(await fileName(one.keys, hash), await fileName(two.keys, hash));
  assert.equal(await fileName(one.keys, hash), await fileName(one.keys, hash));
});

/* Casebook files --------------------------------------------------------- */

async function makeCasefile(passphrase, fileSizes) {
  const files = fileSizes.map((n) => random(n));
  const manifest = {
    app: 'mwf-casebook',
    records: [{ id: newId(), kind: 'case', title: 'Shared case' }],
    files: files.map((data) => ({ sha256: sha(data), size: data.length })),
  };
  const bySha = new Map(files.map((data) => [sha(data), data]));
  const blob = await writeCasefile({
    passphrase,
    manifest,
    iterations: ITERATIONS,
    readChunk: async (file, i) => bySha.get(file.sha256).subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
  });
  return { blob, manifest, files };
}

async function readAll(blob, opened) {
  const parts = new Map();
  await readCasefileFiles(blob, opened, async (file, i, read) => {
    if (!parts.has(file.sha256)) parts.set(file.sha256, []);
    parts.get(file.sha256)[i] = await read();
  });
  return parts;
}

test('a Casebook file carries records and files to another device', async () => {
  const { blob, manifest, files } = await makeCasefile('share-pass-123', [10, CHUNK_SIZE + 1, 0]);
  assert.ok(!Buffer.from(await blob.arrayBuffer()).includes(Buffer.from('Shared case')));
  const opened = await openCasefile(blob, 'share-pass-123');
  assert.deepEqual(opened.manifest, manifest);
  const parts = await readAll(blob, opened);
  for (const data of files) {
    const joined = Buffer.concat(parts.get(sha(data)).map((p) => Buffer.from(p)));
    assert.equal(sha(joined), sha(data));
  }
});

test('a Casebook file refuses the wrong passphrase and other files', async () => {
  const { blob } = await makeCasefile('share-pass-123', [10]);
  await rejectsWith(openCasefile(blob, 'share-pass-124'), 'wrong-passphrase');
  await rejectsWith(readCasefileHeader(new Blob([random(500)])), 'not-casefile');
  await rejectsWith(readCasefileHeader(new Blob([new TextEncoder().encode('{"app":"megafauna-care"}')])), 'not-casefile');
});

test('a cut-short, padded or altered Casebook file is caught', async () => {
  const { blob } = await makeCasefile('share-pass-123', [CHUNK_SIZE + 100]);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const cut = new Blob([bytes.subarray(0, bytes.length - 40)]);
  const openedCut = await openCasefile(cut, 'share-pass-123');
  await rejectsWith(readAll(cut, openedCut), 'damaged');

  const padded = new Blob([bytes, new Uint8Array(5)]);
  await rejectsWith(readAll(padded, await openCasefile(padded, 'share-pass-123')), 'damaged');

  const altered = bytes.slice();
  altered[altered.length - 200] ^= 1; // inside the last file piece or the end frame
  const alteredBlob = new Blob([altered]);
  await rejectsWith(readAll(alteredBlob, await openCasefile(alteredBlob, 'share-pass-123')), 'damaged');
});

test('pieces that are not needed can be skipped', async () => {
  const { blob } = await makeCasefile('share-pass-123', [100, 200]);
  const opened = await openCasefile(blob, 'share-pass-123');
  let read = 0;
  await readCasefileFiles(blob, opened, async (file, i, readPiece) => {
    if (file.size === 200) {
      await readPiece();
      read++;
    }
  });
  assert.equal(read, 1);
});

/* Records ---------------------------------------------------------------- */

const caseRecord = (fields = {}) => clean(Object.assign({
  id: newId(), kind: 'case', ref: 'MWF-2026-TEST', title: 'Dog beaten', type: 'beating', stage: 'investigating',
  created: '2026-10-01T10:00:00.000Z', updated: '2026-10-01T10:00:00.000Z', rev: 1,
}, fields));

test('records from outside are checked before they are trusted', () => {
  assert.equal(clean({ id: '../../etc', kind: 'case' }), null);
  assert.equal(clean({ id: newId(), kind: 'script' }), null);
  assert.equal(clean({ id: newId(), kind: 'person' }), null, 'a person must belong to a case');
  assert.equal(clean({ id: newId(), kind: 'settings', name: 'x' }), null, 'settings never travel');
  const c = caseRecord({ stage: 'nonsense', priority: { $gt: '' }, lat: '999', tags: ['a', 'A', 'b'], legal: { firNumber: 42, nextHearing: '2026-02-30' }, evil: '<script>' });
  assert.equal(c.stage, 'new');
  assert.equal(c.priority, 'normal');
  assert.equal(c.lat, null);
  assert.deepEqual(c.tags, ['a', 'b']);
  assert.equal(c.legal.firNumber, '42');
  assert.equal(c.legal.nextHearing, '');
  assert.equal('evil' in c, false);
  const e = clean({ id: newId(), kind: 'evidence', caseId: c.id, sha256: 'not-a-hash', size: 50, thumb: 'javascript:alert(1)' });
  assert.equal(e.sha256, '');
  assert.equal(e.size, 0);
  assert.equal(e.thumb, '');
});

test('a deleted record keeps nothing but the fact it was deleted', () => {
  const t = clean({ id: newId(), kind: 'person', caseId: newId(), name: 'Secret Witness', phone: '98765', deleted: true, updated: '2026-10-02T00:00:00.000Z', rev: 3 });
  assert.deepEqual(Object.keys(t).sort(), ['caseId', 'deleted', 'id', 'kind', 'rev', 'updated', 'updatedBy']);
});

test('combining keeps the most recent change to each record', () => {
  const base = caseRecord();
  const local = new Map([[base.id, base]]);
  const newer = Object.assign({}, base, { title: 'Dog beaten with a rod', updated: '2026-10-02T09:00:00.000Z', rev: 2 });
  const older = Object.assign({}, base, { title: 'Old title', updated: '2026-09-30T09:00:00.000Z', rev: 1 });
  const fresh = caseRecord({ title: 'New case' });

  let plan = planMerge(local, [newer, fresh, base]);
  assert.deepEqual(plan.put.map((r) => r.title).sort(), ['Dog beaten with a rod', 'New case']);
  assert.deepEqual(plan.stats.case, { added: 1, updated: 1, removed: 0, kept: 0, same: 0 });

  plan = planMerge(local, [older]);
  assert.equal(plan.put.length, 0);
  assert.equal(plan.stats.case.kept, 1);

  const gone = clean(Object.assign({}, base, { deleted: true, updated: '2026-10-03T00:00:00.000Z', rev: 2 }));
  plan = planMerge(local, [gone]);
  assert.equal(plan.stats.case.removed, 1);
  assert.equal(plan.put[0].deleted, true);
});

test('two copies end up the same whichever way they are combined', () => {
  const shared = caseRecord();
  const editA = Object.assign({}, shared, { title: 'A', updated: '2026-10-05T00:00:00.000Z', rev: 2 });
  const editB = Object.assign({}, shared, { title: 'B', updated: '2026-10-05T00:00:00.000Z', rev: 2 });
  assert.notEqual(wins(editA, editB), wins(editB, editA));
  const apply = (mine, theirs) => {
    const map = new Map([[mine.id, mine]]);
    for (const r of planMerge(map, [theirs]).put) map.set(r.id, r);
    return map.get(mine.id);
  };
  assert.equal(canonical(apply(editA, editB)), canonical(apply(editB, editA)));
});

test('log entries are added once and never overwritten', async () => {
  const settings = cleanSettings({ name: 'Udit', deviceName: 'Phone' });
  const entry = await makeLogEntry(settings, { action: 'case.create', text: 'Opened a case' });
  const local = new Map([[entry.id, entry]]);
  const forged = Object.assign({}, entry, { text: 'Something else' });
  const plan = planMerge(local, [forged]);
  assert.equal(plan.put.length, 0);
  assert.equal(plan.stats.log.same, 1);
});

test('exports leave out examples, and confidential people when asked', () => {
  const real = caseRecord();
  const other = caseRecord({ title: 'Other' });
  const example = caseRecord({ example: true });
  const fileHash = sha(random(10));
  const records = [
    real, other, example,
    clean({ id: newId(), kind: 'person', caseId: real.id, role: 'witness', name: 'Hidden', confidential: true }),
    clean({ id: newId(), kind: 'person', caseId: real.id, role: 'police', name: 'Open', confidential: false }),
    clean({ id: newId(), kind: 'evidence', caseId: real.id, type: 'photo', sha256: fileHash, size: 10 }),
    clean({ id: newId(), kind: 'evidence', caseId: real.id, type: 'photo', sha256: fileHash, size: 10 }),
    clean({ id: newId(), kind: 'evidence', caseId: example.id, type: 'photo', sha256: sha(random(5)), size: 5, example: true }),
  ];
  const all = selectForExport(records, { confidential: false });
  assert.equal(all.cases, 2);
  assert.ok(!all.records.some((r) => r.name === 'Hidden'));
  assert.ok(all.records.some((r) => r.name === 'Open'));
  assert.ok(!all.records.some((r) => r.example));
  assert.deepEqual(all.files, [{ sha256: fileHash, size: 10 }]);

  const one = selectForExport(records, { caseIds: new Set([other.id]), files: false });
  assert.deepEqual(one.records.map((r) => r.id), [other.id]);
  assert.deepEqual(one.files, []);
});

test('a file list from another device must match its records', () => {
  const c = caseRecord();
  const h = sha(random(10));
  const records = [clean({ id: newId(), kind: 'evidence', caseId: c.id, sha256: h, size: 10 })];
  assert.deepEqual(cleanFileList([{ sha256: h, size: 10 }], records), [{ sha256: h, size: 10, wanted: true }]);
  assert.equal(cleanFileList([{ sha256: h, size: -1 }], records), null);
  assert.equal(cleanFileList([{ sha256: h, size: 10 }, { sha256: h, size: 10 }], records), null);
  assert.equal(cleanFileList([{ sha256: sha(random(3)), size: 3 }], records)[0].wanted, false);
});

/* Activity log ----------------------------------------------------------- */

async function chain(n, settings = cleanSettings({ name: 'Udit', deviceName: 'Laptop' })) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    const e = await makeLogEntry(settings, { action: 'case.update', text: `Change ${i + 1}` });
    entries.push(e);
    settings.logSeq = e.seq;
    settings.logHead = e.hash;
  }
  return { entries, own: { device: settings.deviceId, seq: settings.logSeq, head: settings.logHead } };
}

test('an untouched activity log checks out', async () => {
  const { entries, own } = await chain(5);
  const result = await verifyLog(entries, own);
  assert.equal(result.ok, true);
  assert.equal(result.devices[0].entries, 5);
});

test('changed, removed or forked log entries are found', async () => {
  const { entries, own } = await chain(5);

  const changed = entries.map((e, i) => (i === 2 ? Object.assign({}, e, { text: 'Rewritten' }) : e));
  assert.equal((await verifyLog(changed, own)).devices[0].changed, 1);

  const middleGone = entries.filter((_, i) => i !== 2);
  assert.equal((await verifyLog(middleGone, own)).devices[0].missing, 1);

  const lastGone = entries.slice(0, 4);
  assert.equal((await verifyLog(lastGone, own)).devices[0].missing, 1);

  const firstGone = entries.slice(1);
  assert.equal((await verifyLog(firstGone, own)).devices[0].missing, 1);

  const forked = entries.concat(Object.assign({}, entries[4], { id: newId() }));
  assert.equal((await verifyLog(forked, own)).devices[0].forked, 1);

  // Rehashing a changed entry still breaks the link to the next one.
  const rehashed = entries.map((e) => Object.assign({}, e));
  rehashed[1].text = 'Rewritten';
  const { logHash } = await import('../../casebook/js/model.js');
  rehashed[1].hash = await logHash(rehashed[1]);
  const report = (await verifyLog(rehashed, own)).devices[0];
  assert.equal(report.changed, 0);
  assert.equal(report.broken, 1);
});

test('entries shared from another device may have gaps', async () => {
  const mine = await chain(2);
  const theirs = await chain(6, cleanSettings({ name: 'Asha', deviceName: 'Phone' }));
  const partial = [theirs.entries[0], theirs.entries[3], theirs.entries[4]];
  const result = await verifyLog(mine.entries.concat(partial), mine.own);
  assert.equal(result.ok, true);
  assert.equal(result.devices.length, 2);
  assert.equal(result.devices[0].own, true);
});

test('the case file checklist ticks what the records show', () => {
  const c = caseRecord({ legal: { firNumber: '123/2026' }, checklist: { scene: true, bogus: true } });
  const items = checklist(c, [
    clean({ id: newId(), kind: 'evidence', caseId: c.id, type: 'video' }),
    clean({ id: newId(), kind: 'person', caseId: c.id, role: 'witness' }),
  ]);
  const done = Object.fromEntries(items.map((i) => [i.key, i.done]));
  assert.deepEqual(done, { photos: true, scene: true, vet: false, witnesses: true, cctv: false, complaint: true, fir: false, certificate: false });
  assert.equal(items.find((i) => i.key === 'scene').auto, false);
});
