/* ==========================================================================
   MegaFauna Casebook
   Case files for animal cruelty investigations: what happened, the animals,
   the people, the evidence and the legal follow-up, kept together and
   encrypted on this device. Cases travel between the team as encrypted
   Casebook files and are combined record by record.
   ========================================================================== */

import * as store from './db.js';
import {
  CasebookError, createVault, unlockVault, changePassphrase, sealRecord, openRecord, fileName, saveFile,
  loadFile, checkFile, hasFile, deleteFile, readFileChunk, storeFileChunk, chunkCount, writeCasefile,
  openCasefile, readCasefileHeader, readCasefileFiles,
} from './vault.js';
import {
  CASE_TYPES, STAGES, OUTCOMES, PRIORITIES, CITIES, SPECIES, SEXES, CONDITIONS, ROLES, EVIDENCE_TYPES,
  ENTRY_TYPES, LEGAL_FIELDS, AUTO_LOCK, clean, cleanSettings, planMerge, selectForExport, cleanFileList,
  makeLogEntry, verifyLog, checklist, newId, newRef, now, isOpen,
} from './model.js';
import { Sha256, toHex, fingerprintBlob } from './sha256.js';
import { readPhotoInfo } from './exif.js';
import { buildExamples } from './examples.js';
import {
  html, raw, setHTML, icon, checked, selected, options, radioPills, today, nowTime, addDays, daysBetween,
  fmtDate, fmtDay, fmtTime, fmtMoment, localDate, relDay, relMoment, fmtNum, plural, fmtBytes, shortHash,
  groupedHash, listText, openSheet, closeSheet, currentSheet, onSheetClose, sheetError, confirmAction,
  closeAllDialogs, withBusy, isBusy, toast, copyText, downloadBlob, applySizes, suggestPassphrase,
  passphraseStrength, scriptURL, clearToast,
} from './ui.js';

/* Settings for the foundation ------------------------------------------ */

const CONFIG = {
  orgName: 'Megafauna Welfare Foundation',
  websiteUrl: '../',
  minPassphrase: 10,
  backupDays: 7, // remind people to back up after this many days
  quietDays: 30, // an open case with no change for this long needs a look
  soonDays: 14, // hearings and tasks this close show on the Overview
  mapUrl: (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`,
};

const THEME_KEY = 'mwf-casebook-theme';
const FILE_EXTENSION = '.casebook';

const main = document.getElementById('main');
const chartTip = document.getElementById('chart-tip');
const chunkStore = store.chunkStore;

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isId = (value) => typeof value === 'string' && /^[a-z0-9]{8,40}$/.test(value);
const byNewest = (key) => (a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0);
const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });

/* The open Casebook ---------------------------------------------------------
   While unlocked, session holds the keys and every record, decrypted, in
   memory. Locking drops all of it.
*/

let vaultExists = false;
let session = null;
let lockNote = '';
let index = null;
let releaseTab = null;
let storageProblem = '';

function messageFor(err) {
  const code = err && err.code;
  const messages = {
    'wrong-passphrase': "That passphrase didn't work. Check it and try again.",
    damaged: "Part of this data is damaged or has been changed, so it can't be trusted.",
    'not-casefile': `That isn't a Casebook file. Choose a file ending in ${FILE_EXTENSION}.`,
    'newer-version': 'This file was made by a newer version of the Casebook. Reload this page to update it, then try again.',
    'missing-file': "This evidence file isn't stored on this device.",
    'changed-file': 'The file changed while it was being saved. Add it again.',
    'in-use': 'The Casebook is open in another tab or window. Lock it or close it there, then try again.',
  };
  if (messages[code]) return messages[code];
  if (err && err.name === 'QuotaExceededError') return 'This device has run out of space for the Casebook. Free up some space and try again.';
  return 'Something went wrong. Try again.';
}

/* Reading records ------------------------------------------------------------ */

const EMPTY_KIDS = Object.freeze({ animal: [], person: [], evidence: [], entry: [], task: [], log: [] });

function idx() {
  if (index) return index;
  const byCase = new Map();
  const cases = [];
  const logs = [];
  const bucket = (id) => {
    if (!byCase.has(id)) byCase.set(id, { animal: [], person: [], evidence: [], entry: [], task: [], log: [] });
    return byCase.get(id);
  };
  for (const r of session.records.values()) {
    if (r.kind === 'log') {
      logs.push(r);
      if (r.caseId) bucket(r.caseId).log.push(r);
    } else if (!r.deleted) {
      if (r.kind === 'case') cases.push(r);
      else bucket(r.caseId)[r.kind].push(r);
    }
  }
  const live = new Set(cases.map((c) => c.id));
  const evidence = [];
  for (const [caseId, kids] of byCase) {
    kids.log.sort(byNewest('at'));
    kids.entry.sort((a, b) => collator.compare(b.date + (b.time || '99'), a.date + (a.time || '99')) || collator.compare(b.created, a.created));
    kids.evidence.sort((a, b) => collator.compare(b.capturedDate || '', a.capturedDate || '') || collator.compare(b.created, a.created));
    kids.task.sort((a, b) => (a.done - b.done) || collator.compare(a.due || '9999', b.due || '9999') || collator.compare(a.created, b.created));
    kids.person.sort((a, b) => Object.keys(ROLES).indexOf(a.role) - Object.keys(ROLES).indexOf(b.role) || collator.compare(a.name, b.name));
    kids.animal.sort((a, b) => collator.compare(a.created, b.created));
    if (live.has(caseId)) evidence.push(...kids.evidence);
  }
  logs.sort(byNewest('at'));
  index = { byCase, cases, live, evidence, logs, touched: new Map(), search: new Map() };
  return index;
}

const kids = (caseId) => idx().byCase.get(caseId) || EMPTY_KIDS;

function getRecord(id) {
  const r = session.records.get(id);
  return r && !r.deleted ? r : null;
}

function getCase(id) {
  const r = getRecord(id);
  return r && r.kind === 'case' ? r : null;
}

const liveCases = () => idx().cases;
const hasExamples = () => Array.from(session.records.values()).some((r) => r.example && !r.deleted);

// When anything in a case last changed.
function lastChange(c) {
  const cache = idx().touched;
  if (!cache.has(c.id)) {
    let latest = c.updated;
    const k = kids(c.id);
    for (const kind of ['animal', 'person', 'evidence', 'entry', 'task']) {
      for (const r of k[kind]) if (r.updated > latest) latest = r.updated;
    }
    cache.set(c.id, latest);
  }
  return cache.get(c.id);
}

function searchText(c) {
  const cache = idx().search;
  if (!cache.has(c.id)) {
    const k = kids(c.id);
    const parts = [c.ref, c.title, c.summary, c.area, c.place, c.lead, CASE_TYPES[c.type], CITIES[c.city] || '', c.tags.join(' '),
      ...Object.values(c.legal)];
    for (const a of k.animal) parts.push(a.name, a.description, a.injuries, SPECIES[a.species]);
    for (const p of k.person) parts.push(p.name, p.phone, p.address, p.notes);
    for (const e of k.evidence) parts.push(e.title, e.fileName, e.notes, e.sha256);
    for (const e of k.entry) parts.push(e.text);
    for (const t of k.task) parts.push(t.title);
    cache.set(c.id, parts.join(' \n ').toLowerCase());
  }
  return cache.get(c.id);
}

/* Saving --------------------------------------------------------------------
   Every write is encrypted and stored in one transaction together with its
   activity log entries and the updated log position, so the log can't fall
   behind the records. Writes queue up one at a time.
*/

let writing = Promise.resolve();

function queued(work) {
  const run = writing.then(work, work);
  writing = run.catch(() => undefined);
  return run;
}

// Stores records exactly as given (already checked) plus new log entries.
function writeRecords(list, logs, settingsChanges) {
  return queued(async () => {
    const s = session;
    if (!s) throw new Error('The Casebook is locked.');
    const settings = cleanSettings(Object.assign({}, s.settings, settingsChanges || {}));
    const entries = [];
    for (const fields of logs || []) {
      const entry = await makeLogEntry(settings, fields);
      settings.logSeq = entry.seq;
      settings.logHead = entry.hash;
      entries.push(entry);
    }
    const boxes = [];
    for (const r of list.concat(entries)) boxes.push({ id: r.id, box: await sealRecord(s.keys, r) });
    if (entries.length || settingsChanges) boxes.push({ id: 'settings', box: await sealRecord(s.keys, settings) });
    await store.putRecords(boxes);
    if (session !== s) return;
    for (const r of list.concat(entries)) s.records.set(r.id, r);
    s.settings = settings;
    index = null;
  });
}

// Saves new or changed records, stamping who changed them and when.
async function save(changes, log) {
  const stamp = now();
  const by = session.settings.name;
  const list = changes.map((rec) => {
    const prev = session.records.get(rec.id);
    const next = clean(Object.assign({}, rec, {
      created: prev && prev.created ? prev.created : stamp,
      createdBy: prev && prev.createdBy ? prev.createdBy : by,
      updated: stamp,
      updatedBy: by,
      rev: prev ? (prev.rev || 1) + 1 : 1,
      example: prev ? Boolean(prev.example) : Boolean(rec.example),
    }));
    if (!next) throw new Error('This record could not be saved.');
    return next;
  });
  await writeRecords(list, log ? [].concat(log) : []);
  return list;
}

const saveSettings = (changes) => writeRecords([], [], changes);

const logOnly = (fields) => writeRecords([], [].concat(fields));

const tombstone = (r) => ({ id: r.id, kind: r.kind, caseId: r.caseId, deleted: true });

/* Evidence files ------------------------------------------------------------ */

const fileHere = (ev) => (ev.sha256 ? hasFile(session.keys, chunkStore, ev) : Promise.resolve(false));

function liveShas() {
  const shas = new Set();
  for (const r of session.records.values()) if (r.kind === 'evidence' && !r.deleted && r.sha256) shas.add(r.sha256);
  return shas;
}

// Deletes stored files that no evidence refers to any more.
async function dropUnusedFiles(shas) {
  const used = liveShas();
  for (const sha of shas) if (sha && !used.has(sha)) await deleteFile(session.keys, chunkStore, sha);
}

// Removes pieces of files left behind by an interrupted save or import.
async function tidyStorage() {
  const stored = await store.storedFileNames();
  if (!stored.size) return;
  const keep = new Set();
  for (const sha of liveShas()) keep.add(await fileName(session.keys, sha));
  for (const name of stored) if (!keep.has(name)) await chunkStore.deleteChunks(name);
}

function guessType(file) {
  const type = file.type || '';
  if (type.startsWith('image/')) return 'photo';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'document';
}

const isViewable = (mime) => /^(image\/(jpeg|png|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|mp4|ogg|wav|webm|aac|x-m4a|mp3))$/.test(mime || '');

// A small preview kept with the record, so lists don't need to decrypt files.
function drawThumb(source, width, height) {
  const scale = Math.min(1, 360 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

function makeThumb(file) {
  const type = file.type || '';
  if (!type.startsWith('image/') && !type.startsWith('video/')) return Promise.resolve('');
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(value || '');
    };
    setTimeout(() => finish(''), 6000);
    if (type.startsWith('image/')) {
      const img = new Image();
      img.onload = () => {
        try {
          finish(drawThumb(img, img.naturalWidth, img.naturalHeight));
        } catch (err) {
          finish('');
        }
      };
      img.onerror = () => finish('');
      img.src = url;
    } else {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      video.onloadeddata = () => {
        video.currentTime = Math.min(1, (video.duration || 2) / 4);
      };
      video.onseeked = () => {
        try {
          finish(drawThumb(video, video.videoWidth, video.videoHeight));
        } catch (err) {
          finish('');
        }
      };
      video.onerror = () => finish('');
      video.src = url;
    }
  });
}

/* Locking and unlocking ---------------------------------------------------- */

// Only one tab may have the Casebook open, so two copies in memory can't
// overwrite each other's changes.
function claimTab() {
  if (!navigator.locks || !navigator.locks.request) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request('mwf-casebook-open', { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false);
        return null;
      }
      resolve(true);
      return new Promise((release) => {
        releaseTab = release;
      });
    }).catch(() => resolve(true));
  });
}

async function openSession(keys, meta, settings) {
  if (!(await claimTab())) throw new CasebookError('in-use');
  const rows = await store.loadRecords();
  const records = new Map();
  let stored = null;
  let damaged = 0;
  for (let i = 0; i < rows.length; i += 100) {
    await Promise.all(rows.slice(i, i + 100).map(async ({ id, box }) => {
      try {
        const value = await openRecord(keys, id, box);
        if (id === 'settings') {
          stored = cleanSettings(value);
        } else {
          const r = clean(value);
          if (r && r.id === id) records.set(id, r);
          else damaged++;
        }
      } catch (err) {
        damaged++;
      }
    }));
  }
  session = { keys, meta, records, settings: settings || stored || cleanSettings({}), damaged };
  index = null;
  lockNote = '';
  lastActive = Date.now();
}

async function setUp(form) {
  const f = form.elements;
  const name = f.name.value.trim();
  const pass = f.passphrase.value;
  const strength = passphraseStrength(pass, CONFIG.minPassphrase);
  const error = (message, field) => {
    const el = document.getElementById('setup-error');
    el.textContent = message;
    el.hidden = false;
    if (field) f[field].focus();
  };
  if (!name) return error('Add your name. It goes in the activity log and on reports.', 'name');
  if (strength.block) return error(pass.length < CONFIG.minPassphrase ? `Use a passphrase of at least ${CONFIG.minPassphrase} characters.` : 'Choose a passphrase that is harder to guess.', 'passphrase');
  if (pass !== f.repeat.value) return error("The two passphrases don't match.", 'repeat');
  if (!f.understood.checked) return error('Tick the box to show you know the passphrase can’t be recovered.', 'understood');

  try {
    await withBusy('Setting up the Casebook…', async () => {
      const { meta, keys } = await createVault(pass);
      await store.putMeta(meta);
      vaultExists = true;
      await openSession(keys, meta, cleanSettings({ name, deviceName: f.deviceName.value.trim() }));
      await writeRecords([], [{ action: 'casebook.create', text: `Set up a new Casebook${session.settings.deviceName ? ` on ${session.settings.deviceName}` : ''}` }], {});
    });
  } catch (err) {
    closeSession();
    if (vaultExists) {
      lockNote = `The Casebook was created, but something went wrong while opening it (${messageFor(err)}) Unlock it with the passphrase you just chose.`;
      render({ focus: true });
    } else error(messageFor(err));
    return undefined;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => false);
  navigate('#overview', true);
  toast('Your Casebook is ready');
}

async function unlock(form) {
  const input = form.elements.passphrase;
  const errorEl = document.getElementById('unlock-error');
  errorEl.hidden = true;
  if (!input.value) {
    errorEl.textContent = 'Enter your passphrase.';
    errorEl.hidden = false;
    input.focus();
    return;
  }
  try {
    await withBusy('Unlocking…', async () => {
      const meta = await store.getMeta();
      if (!meta) {
        vaultExists = false;
        return;
      }
      const keys = await unlockVault(meta, input.value);
      await openSession(keys, meta);
      await tidyStorage().catch(() => undefined);
      await writeRecords([], [{ action: 'casebook.unlock', text: 'Unlocked the Casebook' }]);
    });
  } catch (err) {
    // A session opened before the failure must not keep this tab's claim.
    closeSession();
    input.value = '';
    errorEl.textContent = messageFor(err);
    errorEl.hidden = false;
    input.focus();
    return;
  }
  render({ focus: true, fresh: true });
  if (session && session.damaged) toast(`${plural(session.damaged, 'record')} couldn't be read and ${session.damaged === 1 ? 'was' : 'were'} skipped.`);
}

// Forgets the keys and records and lets another tab open the Casebook.
function closeSession() {
  session = null;
  index = null;
  if (releaseTab) {
    releaseTab();
    releaseTab = null;
  }
}

function lock(reason) {
  if (!session) return;
  closeSession();
  closeAllDialogs();
  clearToast();
  hideChartTip();
  lockNote = reason === 'idle' ? 'Locked because it wasn’t used for a while.'
    : reason === 'hidden' ? 'Locked when you switched to another app or tab.' : '';
  render({ focus: true });
}

/* Locking by itself ----------------------------------------------------------- */

let lastActive = Date.now();
let pickingFile = false;

const markActive = () => {
  lastActive = Date.now();
};
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input']) {
  document.addEventListener(type, markActive, { capture: true, passive: true });
}

function checkIdle() {
  if (!session) return;
  if (isBusy()) {
    markActive();
    return;
  }
  if (Date.now() - lastActive >= session.settings.autoLock * 60000) lock('idle');
}

setInterval(checkIdle, 10000);

document.addEventListener('visibilitychange', () => {
  if (!session) return;
  if (document.visibilityState === 'hidden') {
    // Choosing a photo or using the camera hides the page too; that's fine.
    if (session.settings.lockOnHide && !pickingFile && !isBusy()) lock('hidden');
  } else {
    checkIdle();
  }
});

document.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('input[type="file"]')) pickingFile = true;
}, true);
window.addEventListener('focus', () => setTimeout(() => {
  pickingFile = false;
}, 1500));

/* Shared pieces of interface -------------------------------------------------- */

function chip(tone, iconName, label) {
  return html`<span class="chip${tone ? ' chip-' + tone : ''}">${iconName ? icon(iconName) : ''}${label}</span>`;
}

const STAGE_TONES = { new: 'info', investigating: 'warn', complaint: 'alert', court: 'primary', closed: '' };
const stageChip = (c) => chip(STAGE_TONES[c.stage], '', STAGES[c.stage].label);

function priorityChip(c) {
  if (c.priority === 'urgent') return chip('bad', 'alert', 'Urgent');
  if (c.priority === 'high') return chip('warn', 'flag', 'High priority');
  if (c.priority === 'low') return chip('', '', 'Low priority');
  return '';
}

const exampleChip = (r) => (r.example ? chip('', '', 'Example') : '');

function notice(tone, iconName, body) {
  return html`<div class="notice${tone ? ' notice-' + tone : ''}">${icon(iconName)}<div class="notice-body">${body}</div></div>`;
}

const placeOf = (c) => [c.area, CITIES[c.city] || ''].filter(Boolean).join(', ');

// A label as it reads mid-sentence: "Photo" becomes "photo", "CCTV footage" stays.
const inSentence = (label) => (/^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

function examplesNotice() {
  if (!hasExamples()) return '';
  return notice('', 'info', html`<p><strong>Example cases are showing.</strong> They're made up, to show how a case file fills up. They never leave this device and are left out of every Casebook file.</p>
    <div class="btn-row"><button class="btn btn-sm btn-outline" type="button" data-action="remove-examples">Remove the examples</button></div>`);
}

function damagedNotice() {
  const n = session.damaged;
  if (!n) return '';
  return notice('warn', 'warn', html`<p><strong>${plural(n, 'record')} couldn't be read and ${n === 1 ? 'was' : 'were'} left out.</strong> ${n === 1 ? 'It has' : 'They have'} been damaged, or changed outside the Casebook, so ${n === 1 ? 'it' : 'they'} can't be trusted. If a case, person or file is missing, add it back from a backup or a colleague's Casebook file.</p>`);
}

function backupNotice() {
  const realCases = liveCases().some((c) => !c.example);
  if (!realCases) return '';
  const last = session.settings.lastBackup;
  if (last && daysBetween(localDate(last), today()) < CONFIG.backupDays) return '';
  return notice('warn', 'warn', html`<p><strong>${last ? `Your last backup was ${relDay(localDate(last))}.` : "You haven't backed up the Casebook yet."}</strong> If this browser's data is cleared or the device is lost, a backup file is the only way to get the cases back.</p>
    <div class="btn-row"><button class="btn btn-sm btn-primary" type="button" data-action="backup">${icon('download')} Back up now</button></div>`);
}

function passField({ id, name, label, autocomplete, hint, input }) {
  return html`<div class="field">
    <label for="${id}">${label}</label>
    <div class="pass-wrap">
      <input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" spellcheck="false" autocapitalize="off"${input ? raw(` data-input="${input}"`) : ''}>
      <button class="icon-btn pass-toggle" type="button" data-action="toggle-pass" data-target="${id}" aria-label="Show passphrase" aria-pressed="false">${icon('eye')}</button>
    </div>
    ${hint ? html`<p class="hint">${hint}</p>` : ''}
  </div>`;
}

function strengthMeter(id) {
  return html`<div class="strength" id="${id}" data-level="0" aria-live="polite">
    <span class="strength-bars" aria-hidden="true"><span></span><span></span><span></span></span>
    <span class="strength-label"></span>
  </div>`;
}

function updateStrength(input) {
  const meter = document.getElementById(input.dataset.meter || 'strength');
  if (!meter) return;
  const s = passphraseStrength(input.value, CONFIG.minPassphrase);
  meter.dataset.level = String(s.level);
  meter.querySelector('.strength-label').textContent = s.label;
}

/* Setting up and the lock screen -------------------------------------------- */

function viewSetup() {
  return html`<div class="gate">
    <div class="gate-intro">
      <p class="eyebrow">${CONFIG.orgName}</p>
      <h1 tabindex="-1">Set up the Casebook on this device</h1>
      <p class="lead">One safe place for each cruelty case: what happened, the animals, the people, the evidence and the legal follow-up.</p>
      <ul class="promises">
        <li>${icon('lock')}<span><strong>Encrypted here.</strong> Everything is locked with your passphrase (AES-256) before it's saved in this browser.</span></li>
        <li>${icon('cloud-off')}<span><strong>Nothing is uploaded.</strong> There's no server. The app is built so it can't send your cases anywhere, even by mistake.</span></li>
        <li>${icon('share')}<span><strong>Combine with your team.</strong> Send cases to colleagues as encrypted files, and add theirs to yours.</span></li>
        <li>${icon('fingerprint')}<span><strong>Evidence you can stand behind.</strong> Every file gets a SHA-256 fingerprint when it's added, and the activity log shows who did what.</span></li>
      </ul>
    </div>
    <form class="card gate-card form" data-form="setup" novalidate autocomplete="off">
      <div class="field">
        <label for="s-name">Your name</label>
        <input id="s-name" name="name" type="text" maxlength="80" autocomplete="name" spellcheck="false">
        <p class="hint">Shown in the activity log and on reports.</p>
      </div>
      <div class="field">
        <label for="s-device">This device <span class="optional">(optional)</span></label>
        <input id="s-device" name="deviceName" type="text" maxlength="80" placeholder="For example: Legal team laptop" spellcheck="false">
      </div>
      ${passField({ id: 's-pass', name: 'passphrase', label: 'Passphrase', autocomplete: 'new-password', input: 'new-pass', hint: `At least ${CONFIG.minPassphrase} characters. Four or more random words are strong and easier to remember than symbols.` })}
      <div class="btn-row"><button class="btn btn-sm btn-outline" type="button" data-action="suggest-pass" data-targets="s-pass s-repeat">${icon('sparkle')} Suggest one</button></div>
      ${strengthMeter('strength')}
      ${passField({ id: 's-repeat', name: 'repeat', label: 'Type the passphrase again', autocomplete: 'new-password' })}
      <label class="check"><input type="checkbox" name="understood"><span>I understand that if this passphrase is lost, nobody can open these cases: not me, not the foundation, not anyone.</span></label>
      <p class="error" id="setup-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${icon('lock')} Set up the Casebook</button>
    </form>
    <p class="gate-foot muted small">Moving to a new device or joining the team? Set up the Casebook here first, then add your backup or a colleague's Casebook file from <strong>Share</strong>.</p>
  </div>`;
}

function viewLock() {
  return html`<div class="gate gate-lock">
    <form class="card gate-card form" data-form="unlock" novalidate autocomplete="off">
      <span class="gate-icon">${icon('lock')}</span>
      <div>
        <h1 tabindex="-1">The Casebook is locked</h1>
        <p class="muted">Enter your passphrase to open the case files on this device.</p>
      </div>
      ${lockNote ? notice('', 'info', html`<p>${lockNote}</p>`) : ''}
      ${storageProblem ? notice('warn', 'warn', html`<p>${storageProblem}</p>`) : ''}
      ${passField({ id: 'u-pass', name: 'passphrase', label: 'Passphrase', autocomplete: 'current-password' })}
      <p class="error" id="unlock-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${icon('unlock')} Unlock</button>
      <button class="btn-link" type="button" data-action="forgot">Forgotten your passphrase?</button>
    </form>
    <p class="gate-foot muted small">MegaFauna Casebook keeps ${CONFIG.orgName}'s case files encrypted on this device. <a href="${CONFIG.websiteUrl}">Visit our website</a></p>
  </div>`;
}

function viewUnsupported() {
  return html`<div class="gate"><div class="card gate-card">
    <span class="gate-icon">${icon('warn')}</span>
    <h1 tabindex="-1">This browser can't run the Casebook</h1>
    <p>${storageProblem || 'The Casebook needs a recent browser with secure storage turned on.'}</p>
    <p class="muted">Try the latest Chrome, Edge, Firefox or Safari, outside private or incognito mode.</p>
  </div></div>`;
}

function forgotSheet() {
  openSheet({
    title: 'Forgotten your passphrase?',
    body: html`<p>The passphrase can't be reset or recovered: it is the key that encrypts the cases, and it isn't stored anywhere. That's what keeps the cases safe if this device is lost or stolen.</p>
      <p>If you can't remember it, the only way forward is to erase the Casebook on this device and set it up again. You can then add back cases from a backup file or a colleague's Casebook file, if you have one and know its passphrase.</p>`,
    submitLabel: 'Erase and start again',
    danger: true,
    async onSubmit() {
      closeSheet();
      await eraseCasebook();
      return false;
    },
  });
}

async function eraseCasebook() {
  const ok = await confirmAction({
    title: 'Erase the Casebook from this device?',
    text: "Every case, file and log entry on this device will be deleted. This can't be undone. Cases you've shared or backed up stay in those files.",
    confirmLabel: 'Erase everything',
    typed: 'ERASE',
  });
  if (!ok) return;
  closeSession();
  try {
    await withBusy('Erasing…', () => store.destroy());
  } catch (err) {
    render();
    toast("Couldn't erase everything. Close other tabs with the Casebook open and try again.");
    return;
  }
  vaultExists = false;
  lockNote = '';
  navigate('#overview', true);
  toast('The Casebook was erased from this device');
}

/* Overview ------------------------------------------------------------------ */

function viewOverview() {
  const cases = liveCases();
  const head = html`<header class="view-head">
    <div>
      <h1 tabindex="-1">Overview</h1>
      <p class="lead">${fmtDate(today(), 'long')}${session.settings.deviceName ? ` · ${session.settings.deviceName}` : ''}</p>
    </div>
    <a class="btn btn-primary" href="#new-case">${icon('plus')} New case</a>
  </header>`;

  if (!cases.length) {
    return html`<div class="view">${head}
      ${damagedNotice()}
      <section class="empty card">
        <span class="empty-icon">${icon('folder')}</span>
        <h2>No cases yet</h2>
        <p class="muted">Open a case when cruelty is reported, add what you learn as you go, and keep every photo, report and statement with it.</p>
        <div class="btn-row btn-row-center">
          <a class="btn btn-primary" href="#new-case">${icon('plus')} Open a case</a>
          <a class="btn btn-outline" href="#share">${icon('upload')} Add cases from a file</a>
          <button class="btn btn-outline" type="button" data-action="load-examples">${icon('sparkle')} Show example cases</button>
        </div>
      </section>
    </div>`;
  }

  const open = cases.filter(isOpen);
  const urgent = open.filter((c) => c.priority === 'urgent').length;
  const t = today();
  const hearings = open.filter((c) => c.legal.nextHearing && c.legal.nextHearing >= t && daysBetween(t, c.legal.nextHearing) <= 30).length;
  const evidence = idx().evidence;
  const files = new Map();
  for (const e of evidence) if (e.sha256) files.set(e.sha256, e.size);
  const totalSize = Array.from(files.values()).reduce((a, b) => a + b, 0);

  return html`<div class="view">${head}
    ${damagedNotice()}
    ${examplesNotice()}
    ${backupNotice()}
    <section class="stats" aria-label="At a glance">
      ${statTile('Open cases', fmtNum(open.length), `${fmtNum(cases.length - open.length)} closed`, '#cases', 'open')}
      ${statTile('Urgent', fmtNum(urgent), urgent ? 'need action now' : 'none right now', '#cases', 'urgent')}
      ${statTile('Hearings', fmtNum(hearings), 'in the next 30 days', '#cases', 'hearing')}
      ${statTile('Evidence', fmtNum(evidence.length), files.size ? `${plural(files.size, 'file')}, ${fmtBytes(totalSize)}` : 'items', '#evidence', '')}
    </section>
    ${attentionCard(open)}
    <div class="grid-2">
      ${stageChart(open)}
      ${typeChart(cases)}
    </div>
    ${monthChart(cases)}
    <section class="card section" aria-labelledby="recent-title">
      <div class="section-head">
        <h2 id="recent-title">Recent activity</h2>
        <a class="btn btn-quiet btn-sm" href="#settings">Activity log ${icon('chevron-right')}</a>
      </div>
      ${activityList(idx().logs.filter((e) => e.action !== 'casebook.unlock').slice(0, 8), true)}
    </section>
  </div>`;
}

function statTile(label, value, sub, href, filter) {
  return html`<a class="stat" href="${href}"${filter ? raw(` data-action="filter-cases" data-filter="${filter}"`) : ''}>
    <span class="stat-label">${label}</span>
    <span class="stat-value">${value}</span>
    <span class="stat-sub">${sub}</span>
  </a>`;
}

function attentionCard(open) {
  const t = today();
  const items = [];
  for (const c of open) {
    const where = c.ref;
    if (c.priority === 'urgent') items.push({ rank: 0, sort: c.created, icon: 'alert', tone: 'bad', title: html`<strong>Urgent:</strong> ${c.title}`, meta: `${where} · ${STAGES[c.stage].label}`, href: `#case/${c.id}` });
    const hearing = c.legal.nextHearing;
    if (hearing && hearing >= t && daysBetween(t, hearing) <= CONFIG.soonDays) {
      items.push({ rank: 1, sort: hearing, icon: 'scale', tone: 'info', title: html`<strong>Hearing ${relDay(hearing)}</strong> (${fmtDay(hearing)}): ${c.title}`, meta: [where, c.legal.court].filter(Boolean).join(' · '), href: `#case/${c.id}/legal` });
    }
    for (const task of kids(c.id).task) {
      if (task.done || !task.due) continue;
      if (task.due < t) items.push({ rank: 1, sort: task.due, icon: 'clock', tone: 'bad', title: html`<strong>Overdue</strong> since ${fmtDay(task.due)}: ${task.title}`, meta: `${where} · ${c.title}`, href: `#case/${c.id}` });
      else if (daysBetween(t, task.due) <= 7) items.push({ rank: 2, sort: task.due, icon: 'clock', tone: 'warn', title: html`<strong>Due ${relDay(task.due)}:</strong> ${task.title}`, meta: `${where} · ${c.title}`, href: `#case/${c.id}` });
    }
    const quiet = daysBetween(localDate(lastChange(c)), t);
    if (quiet >= CONFIG.quietDays) items.push({ rank: 3, sort: lastChange(c), icon: 'history', tone: '', title: html`<strong>No change for ${quiet} days:</strong> ${c.title}`, meta: `${where} · ${STAGES[c.stage].label}`, href: `#case/${c.id}` });
  }
  items.sort((a, b) => a.rank - b.rank || collator.compare(a.sort, b.sort));
  const shown = items.slice(0, 8);
  return html`<section class="card section" aria-labelledby="attention-title">
    <div class="section-head">
      <h2 id="attention-title">Needs attention</h2>
      ${items.length ? html`<span class="count-badge">${items.length}</span>` : ''}
    </div>
    ${shown.length ? html`<ul class="attention">
      ${shown.map((item) => html`<li><a class="attention-row" href="${item.href}">
        <span class="attention-icon${item.tone ? ' tone-' + item.tone : ''}">${icon(item.icon)}</span>
        <span class="attention-text"><span>${item.title}</span><span class="muted small">${item.meta}</span></span>
        ${icon('chevron-right', 'row-chevron')}
      </a></li>`)}
    </ul>
    ${items.length > shown.length ? html`<p class="muted small">And ${plural(items.length - shown.length, 'more thing')}. Open the cases to see them all.</p>` : ''}`
    : html`<p class="empty-line">${icon('check')} Nothing urgent, overdue or going quiet.</p>`}
  </section>`;
}

/* Charts --------------------------------------------------------------------
   Plain HTML bars sized from data attributes (see applySizes). Every value
   is written next to its bar or in the table under the chart, so the
   tooltips only ever repeat what's on the page.
*/

function barChart({ id, title, sub, rows, ramp, filterKind }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return html`<section class="card section chart-card" aria-labelledby="${id}">
    <div>
      <h2 id="${id}">${title}</h2>
      ${sub ? html`<p class="muted small">${sub}</p>` : ''}
    </div>
    <ul class="bars">
      ${rows.map((r, i) => html`<li>
        <a class="bar-row" href="#cases" data-action="filter-cases" data-filter="${filterKind}" data-value="${r.key}">
          <span class="bar-label">${r.label}</span>
          <span class="bar-track">
            <span class="bar-fill${ramp ? ' ramp-' + (i + 1) : ''}" data-w="${(r.count / max).toFixed(4)}"></span>
            <span class="bar-value">${fmtNum(r.count)}</span>
          </span>
        </a>
      </li>`)}
    </ul>
    ${chartTable(['', 'Cases'], rows.map((r) => [r.label, fmtNum(r.count)]))}
  </section>`;
}

function stageChart(open) {
  const rows = ['new', 'investigating', 'complaint', 'court'].map((key) => ({ key, label: STAGES[key].label, count: open.filter((c) => c.stage === key).length }));
  return barChart({ id: 'chart-stage', title: 'Open cases by stage', sub: 'From newly reported to in court', rows, ramp: true, filterKind: 'stage' });
}

function typeChart(cases) {
  const counts = new Map();
  for (const c of cases) counts.set(c.type, (counts.get(c.type) || 0) + 1);
  const sorted = Array.from(counts, ([key, count]) => ({ key, label: CASE_TYPES[key], count })).sort((a, b) => b.count - a.count || collator.compare(a.label, b.label));
  let rows = sorted;
  if (sorted.length > 6) {
    const rest = sorted.slice(5);
    rows = sorted.slice(0, 5).concat({ key: '', label: `${rest.length} other types`, count: rest.reduce((sum, r) => sum + r.count, 0) });
  }
  return barChart({ id: 'chart-type', title: 'Cases by type', sub: 'All cases, open and closed', rows, ramp: false, filterKind: 'type' });
}

function niceTop(max) {
  for (const step of [2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (max <= step) return step;
  return Math.ceil(max / 1000) * 1000;
}

function monthChart(cases) {
  const months = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, date: m, count: 0 });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const c of cases) {
    const m = byKey.get(localDate(c.created).slice(0, 7));
    if (m) m.count++;
  }
  const max = Math.max(...months.map((m) => m.count));
  const top = niceTop(Math.max(1, max));
  const peak = months.reduce((best, m, i) => (m.count > months[best].count ? i : best), 0);
  const labelled = new Set([months.length - 1, max ? peak : -1]);
  const monthName = (m, style) => m.date.toLocaleDateString('en-IN', style);
  return html`<section class="card section chart-card" aria-labelledby="chart-month">
    <div>
      <h2 id="chart-month">New cases by month</h2>
      <p class="muted small">The last 12 months, by the date each case was opened</p>
    </div>
    <div class="cols-chart">
      <div class="cols-plot">
        ${[0, top / 2, top].map((v) => html`<span class="gridline" data-y="${(v / top).toFixed(4)}"><span class="tick">${fmtNum(v)}</span></span>`)}
        <ol class="cols">
          ${months.map((m, i) => html`<li class="col" tabindex="0" data-tip="${monthName(m, { month: 'long', year: 'numeric' })}" data-tip-value="${plural(m.count, 'case')}" aria-label="${monthName(m, { month: 'long', year: 'numeric' })}: ${plural(m.count, 'case')}">
            <span class="col-fill" data-h="${(m.count / top).toFixed(4)}">${labelled.has(i) && m.count ? html`<span class="col-value">${fmtNum(m.count)}</span>` : ''}</span>
          </li>`)}
        </ol>
      </div>
      <ol class="col-axis" aria-hidden="true">${months.map((m) => html`<li>${monthName(m, { month: 'short' })}</li>`)}</ol>
    </div>
    ${chartTable(['Month', 'New cases'], months.map((m) => [monthName(m, { month: 'long', year: 'numeric' }), fmtNum(m.count)]))}
  </section>`;
}

function chartTable(head, rows) {
  return html`<details class="table-toggle">
    <summary>${icon('list')} Show as a table</summary>
    <div class="table-wrap"><table class="data-table">
      <thead><tr>${head.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead>
      <tbody>${rows.map((r) => html`<tr><th scope="row">${r[0]}</th><td>${r[1]}</td></tr>`)}</tbody>
    </table></div>
  </details>`;
}

function showChartTip(el) {
  const rect = el.getBoundingClientRect();
  chartTip.replaceChildren();
  const value = document.createElement('strong');
  value.textContent = el.dataset.tipValue || '';
  const label = document.createElement('span');
  label.textContent = el.dataset.tip;
  chartTip.append(value, label);
  chartTip.hidden = false;
  const tipRect = chartTip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - tipRect.width / 2 - 8, Math.max(tipRect.width / 2 + 8, rect.left + rect.width / 2));
  chartTip.style.left = `${left + window.scrollX}px`;
  chartTip.style.top = `${rect.top + window.scrollY}px`;
}

function hideChartTip() {
  chartTip.hidden = true;
}

for (const type of ['pointerover', 'focusin']) {
  document.addEventListener(type, (event) => {
    const el = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
    if (el) showChartTip(el);
  });
}
for (const type of ['pointerout', 'focusout']) {
  document.addEventListener(type, (event) => {
    if (event.target instanceof Element && event.target.closest('[data-tip]')) hideChartTip();
  });
}
window.addEventListener('scroll', hideChartTip, { passive: true });

function activityList(entries, withCase) {
  if (!entries.length) return html`<p class="muted">Nothing yet.</p>`;
  return html`<ul class="activity">
    ${entries.map((e) => {
      const c = withCase && e.caseId ? getCase(e.caseId) : null;
      return html`<li>
        <span class="activity-icon">${icon(actionIcon(e.action))}</span>
        <div class="activity-body">
          <p>${e.text}${c ? html` · <a href="#case/${c.id}">${c.ref}</a>` : ''}</p>
          <p class="muted small">${e.by || 'Someone'}${e.deviceName ? ` on ${e.deviceName}` : ''} · <time datetime="${e.at}" title="${fmtMoment(e.at)}">${relMoment(e.at)}</time></p>
        </div>
      </li>`;
    })}
  </ul>`;
}

function actionIcon(action) {
  const kind = action.split('.')[0];
  return { case: 'folder', evidence: 'fingerprint', person: 'user', animal: 'paw', entry: 'note', task: 'check', legal: 'scale', file: 'share', casebook: 'lock' }[kind] || 'note';
}

/* Cases --------------------------------------------------------------------- */

const caseFilter = { query: '', stage: 'open', type: '', city: '', sort: 'changed', flag: '' };

const STAGE_FILTERS = { open: 'Open cases', all: 'All cases', new: 'New', investigating: 'Investigating', complaint: 'Complaint filed', court: 'In court', closed: 'Closed' };
const SORTS = { changed: 'Recently changed', incident: 'Date of incident', opened: 'Date opened', priority: 'Priority' };
const PRIORITY_ORDER = Object.keys(PRIORITIES);

function filteredCases() {
  const q = caseFilter.query.trim().toLowerCase();
  const t = today();
  let list = liveCases().filter((c) => {
    if (caseFilter.stage === 'open' && !isOpen(c)) return false;
    if (caseFilter.stage !== 'open' && caseFilter.stage !== 'all' && c.stage !== caseFilter.stage) return false;
    if (caseFilter.type && c.type !== caseFilter.type) return false;
    if (caseFilter.city && c.city !== caseFilter.city) return false;
    if (caseFilter.flag === 'urgent' && c.priority !== 'urgent') return false;
    if (caseFilter.flag === 'hearing' && !(c.legal.nextHearing && c.legal.nextHearing >= t && daysBetween(t, c.legal.nextHearing) <= 30)) return false;
    return !q || q.split(/\s+/).every((word) => searchText(c).includes(word));
  });
  const sorts = {
    changed: (a, b) => collator.compare(lastChange(b), lastChange(a)),
    incident: (a, b) => collator.compare(b.incidentDate || localDate(b.created), a.incidentDate || localDate(a.created)),
    opened: (a, b) => collator.compare(b.created, a.created),
    priority: (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || collator.compare(lastChange(b), lastChange(a)),
  };
  list = list.slice().sort(sorts[caseFilter.sort] || sorts.changed);
  return list;
}

function viewCases() {
  const all = liveCases();
  const open = all.filter(isOpen).length;
  return html`<div class="view">
    <header class="view-head">
      <div>
        <h1 tabindex="-1">Cases</h1>
        <p class="lead">${plural(open, 'open case')} · ${fmtNum(all.length - open)} closed</p>
      </div>
      <a class="btn btn-primary" href="#new-case">${icon('plus')} New case</a>
    </header>
    ${examplesNotice()}
    <div class="filters" role="search">
      <div class="search-box">
        ${icon('search')}
        <label class="visually-hidden" for="case-search">Search cases</label>
        <input id="case-search" type="search" value="${caseFilter.query}" placeholder="Search titles, places, people, FIR numbers…" data-input="case-search" autocomplete="off" spellcheck="false">
      </div>
      <div class="filter-row">
        <label class="select-chip"><span class="visually-hidden">Stage</span><select data-input="case-filter" data-key="stage">${options(STAGE_FILTERS, caseFilter.stage)}</select></label>
        <label class="select-chip"><span class="visually-hidden">Type</span><select data-input="case-filter" data-key="type"><option value="">All types</option>${options(CASE_TYPES, caseFilter.type)}</select></label>
        <label class="select-chip"><span class="visually-hidden">Place</span><select data-input="case-filter" data-key="city"><option value="">All places</option>${options(CITIES, caseFilter.city)}</select></label>
        <label class="select-chip"><span class="visually-hidden">Sort by</span><select data-input="case-filter" data-key="sort">${options(SORTS, caseFilter.sort)}</select></label>
      </div>
      ${caseFilter.flag ? html`<p class="filter-flag">${chip(caseFilter.flag === 'urgent' ? 'bad' : 'info', caseFilter.flag === 'urgent' ? 'alert' : 'scale', caseFilter.flag === 'urgent' ? 'Urgent only' : 'Hearing in the next 30 days')}
        <button class="btn-link" type="button" data-action="clear-flag">Show all</button></p>` : ''}
    </div>
    <div id="case-results">${caseResults()}</div>
  </div>`;
}

function caseResults() {
  const list = filteredCases();
  if (!liveCases().length) {
    return html`<div class="empty"><p>No cases yet.</p><a class="btn btn-primary" href="#new-case">${icon('plus')} Open a case</a></div>`;
  }
  if (!list.length) return html`<div class="empty"><p>No cases match. Try another search or filter.</p></div>`;
  return html`<p class="muted small results-count" aria-live="polite">${plural(list.length, 'case')}</p>
    <ul class="case-list">${list.map(caseRow)}</ul>`;
}

function caseRow(c) {
  const k = kids(c.id);
  const when = c.incidentDate ? fmtDay(c.incidentDate) : fmtDay(localDate(c.created));
  const where = placeOf(c);
  return html`<li><a class="case-row priority-${c.priority}" href="#case/${c.id}">
    <span class="case-row-main">
      <span class="case-ref">${c.ref}</span>
      <span class="case-title">${c.title || 'Untitled case'}</span>
      <span class="case-meta">${CASE_TYPES[c.type]}${where ? ` · ${where}` : ''} · ${when}</span>
      <span class="chips">${stageChip(c)}${priorityChip(c)}${exampleChip(c)}
        ${k.evidence.length ? chip('', 'fingerprint', plural(k.evidence.length, 'evidence item')) : ''}
        ${k.animal.length ? chip('', 'paw', plural(k.animal.reduce((n, a) => n + a.count, 0), 'animal')) : ''}</span>
    </span>
    ${icon('chevron-right', 'row-chevron')}
  </a></li>`;
}

function refreshCaseResults() {
  const box = document.getElementById('case-results');
  if (box) setHTML(box, caseResults());
}

/* One case ---------------------------------------------------------------------- */

const CASE_TABS = { details: 'Details', evidence: 'Evidence', people: 'People', diary: 'Diary', legal: 'Legal', activity: 'Activity' };

function notFound() {
  return html`<div class="view">
    <a class="back" href="#cases">${icon('chevron-left')} Cases</a>
    <div class="empty"><h1 tabindex="-1">Case not found</h1><p class="muted">It may have been deleted, or it isn't on this device.</p></div>
  </div>`;
}

function viewCase(route) {
  const c = getCase(route.id);
  if (!c) return notFound();
  const k = kids(c.id);
  const counts = { evidence: k.evidence.length, people: k.person.length, diary: k.entry.length };
  const when = [c.incidentDate ? `${fmtDate(c.incidentDate)}${c.incidentTime ? `, ${fmtTime(c.incidentTime)}` : ''}` : '', placeOf(c)].filter(Boolean).join(' · ');
  const body = {
    details: caseDetails,
    evidence: caseEvidence,
    people: casePeople,
    diary: caseDiary,
    legal: caseLegal,
    activity: caseActivity,
  }[route.tab](c, k);

  return html`<div class="view case-view">
    <a class="back" href="#cases">${icon('chevron-left')} Cases</a>
    <header class="case-head">
      <p class="case-ref">${c.ref}</p>
      <h1 tabindex="-1">${c.title || 'Untitled case'}</h1>
      <div class="chips">${stageChip(c)}${priorityChip(c)}${chip('', '', CASE_TYPES[c.type])}${exampleChip(c)}</div>
      ${when ? html`<p class="case-sub">${icon('pin')} ${when}</p>` : ''}
      ${c.stage === 'closed' && c.outcome ? html`<p class="case-sub">${icon('check')} Closed${c.closedOn ? ` on ${fmtDate(c.closedOn)}` : ''}: ${OUTCOMES[c.outcome]}</p>` : ''}
      <div class="btn-row">
        <a class="btn btn-sm btn-outline" href="#edit-case/${c.id}">${icon('edit')} Edit</a>
        <button class="btn btn-sm btn-outline" type="button" data-action="change-stage" data-id="${c.id}">${icon('flag')} Change stage</button>
        <button class="btn btn-sm btn-outline" type="button" data-action="share-case" data-id="${c.id}">${icon('share')} Share</button>
        <a class="btn btn-sm btn-outline" href="#report/${c.id}">${icon('printer')} Report</a>
      </div>
    </header>
    <nav class="case-tabs" aria-label="Parts of this case">
      ${Object.keys(CASE_TABS).map((tab) => html`<a href="#case/${c.id}${tab === 'details' ? '' : '/' + tab}"${raw(route.tab === tab ? ' aria-current="page"' : '')}>${CASE_TABS[tab]}${counts[tab] ? html` <span class="tab-count">${counts[tab]}</span>` : ''}</a>`)}
    </nav>
    <div class="case-body">${body}</div>
  </div>`;
}

function caseDetails(c, k) {
  const items = checklist(c, Object.values(k).flat());
  const done = items.filter((i) => i.done).length;
  return html`<div class="case-grid">
    <div class="case-main">
      <section class="card section" aria-labelledby="what-title">
        <div class="section-head"><h2 id="what-title">What happened</h2><a class="btn btn-quiet btn-sm" href="#edit-case/${c.id}">${icon('edit')} Edit</a></div>
        ${c.summary ? html`<div class="prose">${c.summary.split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}</div>` : html`<p class="muted">No summary yet. <a href="#edit-case/${c.id}">Add one</a>: what happened, when, and how it came to the foundation.</p>`}
        ${c.tags.length ? html`<div class="chips">${c.tags.map((t) => chip('', 'tag', t))}</div>` : ''}
      </section>

      <section class="card section" aria-labelledby="animals-title">
        <div class="section-head"><h2 id="animals-title">Animals</h2><button class="btn btn-quiet btn-sm" type="button" data-action="add-animal" data-case="${c.id}">${icon('plus')} Add</button></div>
        ${k.animal.length ? html`<ul class="mini-list">${k.animal.map((a) => html`<li><button class="mini-card" type="button" data-action="edit-animal" data-id="${a.id}">
          <span class="mini-card-head"><strong>${a.name || SPECIES[a.species]}${a.count > 1 ? ` × ${fmtNum(a.count)}` : ''}</strong>${chip(CONDITIONS[a.condition].tone, '', CONDITIONS[a.condition].label)}</span>
          <span class="muted small">${[a.name ? SPECIES[a.species] : '', a.sex !== 'unknown' ? SEXES[a.sex] : ''].filter(Boolean).join(' · ')}</span>
          ${a.description ? html`<span>${a.description}</span>` : ''}
          ${a.injuries ? html`<span class="small"><strong>Injuries:</strong> ${a.injuries}</span>` : ''}
        </button></li>`)}</ul>` : html`<p class="muted">Add the animals involved, how to recognise them and what happened to them.</p>`}
      </section>

      <section class="card section" aria-labelledby="tasks-title">
        <div class="section-head"><h2 id="tasks-title">Tasks</h2><button class="btn btn-quiet btn-sm" type="button" data-action="add-task" data-case="${c.id}">${icon('plus')} Add</button></div>
        ${k.task.length ? html`<ul class="tasks">${k.task.map((task) => taskRow(task))}</ul>` : html`<p class="muted">Next steps and deadlines, like collecting the post-mortem report or following up with the police.</p>`}
      </section>
    </div>

    <div class="case-side">
      <section class="card section" aria-labelledby="checklist-title">
        <div class="section-head"><h2 id="checklist-title">Case file</h2><span class="muted small">${done} of ${items.length}</span></div>
        <progress class="meter" max="${items.length}" value="${done}" aria-label="Case file progress">${done} of ${items.length}</progress>
        <ul class="checklist">
          ${items.map((item) => item.auto
            ? html`<li class="is-done is-auto">${icon('check')}<span>${item.label}<span class="hint">From the case records</span></span></li>`
            : html`<li class="${item.done ? 'is-done' : ''}"><button type="button" class="check-btn" data-action="toggle-check" data-case="${c.id}" data-key="${item.key}" aria-pressed="${item.done ? 'true' : 'false'}">${icon(item.done ? 'check' : 'circle')}<span>${item.label}</span></button></li>`)}
        </ul>
      </section>

      <section class="card section" aria-labelledby="where-title">
        <h2 id="where-title">When and where</h2>
        <dl class="facts">
          ${fact('Incident', c.incidentDate ? `${fmtDate(c.incidentDate)}${c.incidentTime ? `, ${fmtTime(c.incidentTime)}` : ''}` : '')}
          ${fact('Reported', c.reportedDate ? fmtDate(c.reportedDate) : '')}
          ${fact('Opened', fmtMoment(c.created))}
          ${fact('Place', [c.place, placeOf(c)].filter(Boolean).join(', '))}
          ${fact('Lead', c.lead)}
        </dl>
        ${c.lat != null && c.lng != null ? html`<div class="btn-row">
          <button class="btn btn-sm btn-outline" type="button" data-action="copy" data-copy="${c.lat}, ${c.lng}">${icon('copy')} ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</button>
          <a class="btn btn-sm btn-quiet" href="${CONFIG.mapUrl(c.lat, c.lng)}" target="_blank" rel="noopener noreferrer">${icon('external')} Open map</a>
        </div>` : ''}
      </section>

      <section class="section danger-zone">
        <button class="btn btn-danger btn-sm" type="button" data-action="delete-case" data-id="${c.id}">${icon('trash')} Delete this case</button>
      </section>
    </div>
  </div>`;
}

function fact(label, value) {
  if (!value) return '';
  return html`<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function taskRow(task) {
  const t = today();
  const due = task.due ? (task.done ? fmtDay(task.due) : task.due < t ? `Overdue since ${fmtDay(task.due)}` : `Due ${relDay(task.due)}`) : '';
  const tone = !task.done && task.due && task.due < t ? 'bad' : !task.done && task.due && daysBetween(t, task.due) <= 2 ? 'warn' : '';
  return html`<li class="task${task.done ? ' is-done' : ''}">
    <label class="task-check"><input type="checkbox" data-input="task-done" data-id="${task.id}"${checked(task.done)}><span class="visually-hidden">Done: </span></label>
    <button class="task-body" type="button" data-action="edit-task" data-id="${task.id}">
      <span class="task-title">${task.title}</span>
      ${due ? html`<span class="small${tone ? ' tone-' + tone : ' muted'}">${task.done ? `Done${task.doneOn ? ` ${fmtDay(task.doneOn)}` : ''}` : due}</span>` : task.done ? html`<span class="small muted">Done</span>` : ''}
    </button>
  </li>`;
}

function caseEvidence(c, k) {
  const files = k.evidence.filter((e) => e.sha256);
  return html`<section class="section">
    <div class="evidence-actions">
      <label class="btn btn-primary file-btn">${icon('upload')} Add files
        <input class="visually-hidden" type="file" multiple data-input="evidence-files" data-case="${c.id}">
      </label>
      <label class="btn btn-outline file-btn camera-only">${icon('camera')} Camera
        <input class="visually-hidden" type="file" accept="image/*,video/*" capture="environment" data-input="evidence-files" data-case="${c.id}">
      </label>
      <button class="btn btn-outline" type="button" data-action="add-item" data-case="${c.id}">${icon('box')} Physical item</button>
      ${files.length ? html`<button class="btn btn-quiet" type="button" data-action="check-all" data-case="${c.id}">${icon('fingerprint')} Check fingerprints</button>` : ''}
    </div>
    <p class="muted small">Add original files, straight from the camera or phone, without editing them. Each one is fingerprinted (SHA-256) and encrypted as it's added. Keep the originals too until the case is over.</p>
    ${k.evidence.length ? html`<ul class="evidence-grid">${k.evidence.map(evidenceCard)}</ul>`
      : html`<div class="empty"><span class="empty-icon">${icon('fingerprint')}</span><p>No evidence yet. Photos, videos, vet reports, statements and FIR copies all belong here.</p></div>`}
  </section>`;
}

function evidenceCard(ev) {
  const type = EVIDENCE_TYPES[ev.type];
  return html`<li><button class="evidence-card" type="button" data-action="open-evidence" data-id="${ev.id}">
    <span class="evidence-thumb">${ev.thumb ? html`<img src="${ev.thumb}" alt="">` : icon(type.icon)}</span>
    <span class="evidence-info">
      <span class="evidence-title">${ev.title || ev.fileName || type.label}</span>
      <span class="muted small">${type.label}${ev.capturedDate ? ` · ${fmtDay(ev.capturedDate)}` : ''}${ev.sha256 ? ` · ${fmtBytes(ev.size)}` : ''}</span>
      ${ev.sha256 ? html`<span class="hash-short">${icon('fingerprint')}${shortHash(ev.sha256)}</span>` : html`<span class="muted small">No file: a record of a physical item</span>`}
      ${checkChip(ev)}
    </span>
  </button></li>`;
}

// The latest fingerprint check, from the activity log.
function lastCheck(ev) {
  return kids(ev.caseId).log.find((e) => e.target === ev.id && (e.action === 'evidence.check' || e.action === 'evidence.mismatch' || e.action === 'evidence.receive'));
}

function checkChip(ev) {
  if (!ev.sha256) return '';
  const last = lastCheck(ev);
  if (!last) return '';
  if (last.action === 'evidence.mismatch') return chip('bad', 'warn', 'Fingerprint does not match');
  return chip('good', 'check', `Checked ${fmtDay(localDate(last.at))}`);
}

function casePeople(c, k) {
  const groups = Object.keys(ROLES).map((role) => ({ role, people: k.person.filter((p) => p.role === role) })).filter((g) => g.people.length);
  return html`<section class="section">
    <div class="btn-row"><button class="btn btn-primary" type="button" data-action="add-person" data-case="${c.id}">${icon('plus')} Add a person</button></div>
    <p class="muted small">People marked confidential can be left out when you share the case or print a report.</p>
    ${groups.length ? groups.map((g) => html`<section class="section" aria-label="${ROLES[g.role].plural}">
      <h2 class="group-title">${ROLES[g.role].plural}</h2>
      <ul class="mini-list">${g.people.map((p) => html`<li><button class="mini-card" type="button" data-action="edit-person" data-id="${p.id}">
        <span class="mini-card-head"><strong>${p.name || ROLES[p.role].label}</strong>${p.confidential ? chip('alert', 'lock', 'Confidential') : ''}</span>
        ${p.phone ? html`<span class="small">${icon('phone')} ${p.phone}</span>` : ''}
        ${p.address ? html`<span class="small muted">${p.address}</span>` : ''}
        ${p.notes ? html`<span class="small">${p.notes}</span>` : ''}
      </button></li>`)}</ul>
    </section>`) : html`<div class="empty"><span class="empty-icon">${icon('users')}</span><p>Add the reporter, witnesses, anyone accused, and the vets, police and lawyers involved.</p></div>`}
  </section>`;
}

function caseDiary(c, k) {
  return html`<section class="section">
    <div class="btn-row"><button class="btn btn-primary" type="button" data-action="add-entry" data-case="${c.id}">${icon('plus')} Add to the diary</button></div>
    ${k.entry.length ? html`<ol class="timeline">${k.entry.map((e) => html`<li>
      <span class="timeline-icon">${icon(ENTRY_TYPES[e.type].icon)}</span>
      <button class="timeline-body" type="button" data-action="edit-entry" data-id="${e.id}">
        <span class="timeline-head"><strong>${ENTRY_TYPES[e.type].label}</strong><span class="muted small">${fmtDate(e.date)}${e.time ? `, ${fmtTime(e.time)}` : ''}</span></span>
        <span class="prose">${e.text.split(/\n{2,}/).map((p) => html`<span class="para">${p}</span>`)}</span>
        <span class="muted small">${e.createdBy || ''}</span>
      </button>
    </li>`)}</ol>` : html`<div class="empty"><span class="empty-icon">${icon('note')}</span><p>Keep a running record: visits, calls, what the police or vet said, and what was decided.</p></div>`}
  </section>`;
}

function caseLegal(c) {
  const L = c.legal;
  const input = (key, type) => {
    const field = LEGAL_FIELDS[key];
    return html`<div class="field">
      <label for="l-${key}">${field.label}</label>
      ${type === 'textarea'
        ? html`<textarea id="l-${key}" name="${key}" maxlength="${field.max}" rows="3">${L[key]}</textarea>`
        : html`<input id="l-${key}" name="${key}" type="${field.date ? 'date' : type || 'text'}" value="${L[key]}"${field.max ? raw(` maxlength="${field.max}"`) : ''} spellcheck="false">`}
    </div>`;
  };
  return html`<div class="case-grid">
    <form class="case-main card form" data-form="legal" data-id="${c.id}" novalidate autocomplete="off">
      <fieldset class="field-group">
        <legend>Police</legend>
        <div class="field-row">${input('policeStation')}${input('complaintDate')}</div>
        <div class="field-row">${input('firNumber')}${input('firDate')}</div>
        ${input('sections')}
        <div class="field-row">${input('io')}${input('ioPhone', 'tel')}</div>
      </fieldset>
      <fieldset class="field-group">
        <legend>Court</legend>
        <div class="field-row">${input('court')}${input('courtCase')}</div>
        <div class="field-row">${input('nextHearing')}${input('lawyer')}</div>
      </fieldset>
      <fieldset class="field-group">
        <legend>Other</legend>
        ${input('otherComplaints', 'textarea')}
        ${input('notes', 'textarea')}
      </fieldset>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('check')} Save legal details</button></div>
    </form>
    <aside class="case-side">
      <section class="card section guide-card">
        <h2>If the police won't register an FIR</h2>
        <ol class="steps-small">
          <li>Give the complaint in writing and keep a copy stamped as received.</li>
          <li>Send it to the Superintendent of Police (BNSS s.173(4)).</li>
          <li>If that fails, a Magistrate can be asked to order an investigation (BNSS s.175(3)), with a copy of what was sent to the SP and an affidavit.</li>
        </ol>
        <a class="btn btn-quiet btn-sm" href="#guide">${icon('book')} Investigation guide</a>
      </section>
      <section class="card section guide-card">
        <h2>Electronic evidence</h2>
        <p class="small">Photos and videos used in court need a certificate under section 63(4) of the Bharatiya Sakshya Adhiniyam, 2023, which asks for each file's hash value. The case report lists the SHA-256 fingerprint of every file.</p>
        <a class="btn btn-quiet btn-sm" href="#report/${c.id}">${icon('printer')} Case report</a>
      </section>
    </aside>
  </div>`;
}

function caseActivity(c, k) {
  return html`<section class="card section">
    <div class="section-head"><h2>Activity</h2><span class="muted small">${plural(k.log.length, 'entry', 'entries')}</span></div>
    <p class="muted small">Everything done to this case, by whom and when, including when it was shared. The log can't be edited: each entry is linked to the one before it.</p>
    ${activityList(k.log, false)}
  </section>`;
}

function mountCase(route) {
  applySizes(main);
}

/* Opening or editing a case -------------------------------------------------- */

function viewCaseForm(route) {
  const editing = route.name === 'edit-case';
  const c = editing ? getCase(route.id) : null;
  if (editing && !c) return notFound();
  const v = c || { title: '', type: 'beating', stage: 'new', priority: 'normal', incidentDate: '', incidentTime: '', reportedDate: today(), city: '', area: '', place: '', lat: null, lng: null, summary: '', lead: session.settings.name, tags: [], outcome: '', ref: '' };
  return html`<div class="view">
    <a class="back" href="${editing ? `#case/${c.id}` : '#cases'}">${icon('chevron-left')} ${editing ? 'Back to the case' : 'Cases'}</a>
    <header class="view-head"><div>
      <h1 tabindex="-1">${editing ? 'Edit case' : 'Open a new case'}</h1>
      ${editing ? '' : html`<p class="lead">Start with what you know. Everything can be added to or changed later.</p>`}
    </div></header>
    <form class="form card" data-form="case" novalidate autocomplete="off">
      <div class="field">
        <label for="c-title">Short title</label>
        <input id="c-title" name="title" type="text" maxlength="160" value="${v.title}" placeholder="For example: Dog poisoned near Sector 22 market" required>
        <p class="error" id="c-title-error" hidden>Give the case a short title.</p>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="c-type">Type of case</label>
          <select id="c-type" name="type">${options(CASE_TYPES, v.type)}</select>
        </div>
        <div class="field">
          <label for="c-stage">Stage</label>
          <select id="c-stage" name="stage" data-input="stage-select">${Object.keys(STAGES).map((key) => html`<option value="${key}"${selected(key === v.stage)}>${STAGES[key].label}</option>`)}</select>
        </div>
      </div>
      <div class="field" id="c-outcome-field"${raw(v.stage === 'closed' ? '' : ' hidden')}>
        <label for="c-outcome">Outcome</label>
        <select id="c-outcome" name="outcome"><option value="">Not recorded</option>${options(OUTCOMES, v.outcome)}</select>
      </div>
      <fieldset class="field">
        <legend>Priority</legend>
        ${radioPills('priority', PRIORITIES, v.priority)}
      </fieldset>
      <div class="field-row">
        <div class="field"><label for="c-date">Date of incident</label><input id="c-date" name="incidentDate" type="date" value="${v.incidentDate}" max="${today()}"></div>
        <div class="field"><label for="c-time">Time <span class="optional">(if known)</span></label><input id="c-time" name="incidentTime" type="time" value="${v.incidentTime}"></div>
        <div class="field"><label for="c-reported">Reported to us</label><input id="c-reported" name="reportedDate" type="date" value="${v.reportedDate}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="c-city">City</label><select id="c-city" name="city"><option value="">Choose…</option>${options(CITIES, v.city)}</select></div>
        <div class="field"><label for="c-area">Sector or area</label><input id="c-area" name="area" type="text" maxlength="120" value="${v.area}" placeholder="For example: Sector 22"></div>
      </div>
      <div class="field">
        <label for="c-place">Exact place or landmark</label>
        <input id="c-place" name="place" type="text" maxlength="300" value="${v.place}">
      </div>
      <div class="field">
        <span class="field-label" id="c-gps-label">Map position <span class="optional">(optional)</span></span>
        <div class="field-row gps-row" role="group" aria-labelledby="c-gps-label">
          <input name="lat" type="text" inputmode="decimal" value="${v.lat == null ? '' : v.lat}" placeholder="Latitude" aria-label="Latitude">
          <input name="lng" type="text" inputmode="decimal" value="${v.lng == null ? '' : v.lng}" placeholder="Longitude" aria-label="Longitude">
          <button class="btn btn-outline" type="button" data-action="locate">${icon('locate')} Where I am</button>
        </div>
        <p class="hint" id="c-gps-hint">Use "Where I am" only when you're at the place itself.</p>
      </div>
      <div class="field">
        <label for="c-summary">What happened</label>
        <textarea id="c-summary" name="summary" rows="7" maxlength="20000" placeholder="What happened, to which animals, who saw it, and how it came to the foundation.">${v.summary}</textarea>
      </div>
      <div class="field-row">
        <div class="field"><label for="c-lead">Lead investigator</label><input id="c-lead" name="lead" type="text" maxlength="80" value="${v.lead}" spellcheck="false"></div>
        <div class="field"><label for="c-tags">Tags <span class="optional">(separate with commas)</span></label><input id="c-tags" name="tags" type="text" maxlength="400" value="${v.tags.join(', ')}"></div>
      </div>
      ${editing ? html`<div class="field"><label for="c-ref">Case reference</label><input id="c-ref" name="ref" type="text" maxlength="40" value="${v.ref}" spellcheck="false"><p class="hint">Change it if you use your own numbering, for example to match a paper file.</p></div>` : ''}
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${icon('check')} ${editing ? 'Save changes' : 'Open the case'}</button>
        <a class="btn btn-outline" href="${editing ? `#case/${c.id}` : '#cases'}">Cancel</a>
      </div>
    </form>
  </div>`;
}

const CASE_FIELDS = {
  title: 'title', ref: 'reference', type: 'type', priority: 'priority', incidentDate: 'incident date', incidentTime: 'incident time',
  reportedDate: 'date reported', city: 'city', area: 'area', place: 'place', lat: 'map position', lng: 'map position',
  summary: 'summary', lead: 'lead investigator', tags: 'tags', outcome: 'outcome',
};

function describeChanges(prev, next, labels) {
  const changed = [];
  for (const [key, label] of Object.entries(labels)) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key]) && !changed.includes(label)) changed.push(label);
  }
  return changed;
}

async function submitCase(form) {
  const route = parseRoute(routeHash);
  const prev = route.name === 'edit-case' ? getCase(route.id) : null;
  const f = form.elements;
  const title = f.title.value.trim();
  if (!title) {
    f.title.setAttribute('aria-invalid', 'true');
    document.getElementById('c-title-error').hidden = false;
    f.title.focus();
    return;
  }
  const stage = f.stage.value;
  const record = Object.assign({}, prev || { id: newId(), kind: 'case', ref: newRef(), checklist: {}, legal: {} }, {
    title,
    type: f.type.value,
    stage,
    outcome: stage === 'closed' ? f.outcome.value : '',
    closedOn: stage === 'closed' ? (prev && prev.stage === 'closed' && prev.closedOn ? prev.closedOn : today()) : '',
    priority: f.priority.value,
    incidentDate: f.incidentDate.value,
    incidentTime: f.incidentTime.value,
    reportedDate: f.reportedDate.value,
    city: f.city.value,
    area: f.area.value.trim(),
    place: f.place.value.trim(),
    lat: f.lat.value.trim(),
    lng: f.lng.value.trim(),
    summary: f.summary.value.trim(),
    lead: f.lead.value.trim(),
    tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
  });
  if (prev && f.ref) record.ref = f.ref.value.trim() || prev.ref;
  const cleaned = clean(Object.assign({}, record, { updated: now() }));
  if ((f.lat.value.trim() || f.lng.value.trim()) && (cleaned.lat == null || cleaned.lng == null)) {
    toast('The map position isn’t valid, so it wasn’t saved. Use decimal degrees, like 30.7333 and 76.7794.');
    record.lat = null;
    record.lng = null;
  }
  let log;
  if (!prev) {
    log = { action: 'case.create', caseId: record.id, target: record.id, text: `Opened the case ${cleaned.ref}` };
  } else {
    const changes = describeChanges(prev, cleaned, CASE_FIELDS);
    const stageMoved = prev.stage !== cleaned.stage;
    if (!changes.length && !stageMoved) {
      navigate(`#case/${prev.id}`);
      return;
    }
    const parts = [];
    if (stageMoved) parts.push(`Moved from ${STAGES[prev.stage].label} to ${STAGES[cleaned.stage].label}`);
    if (changes.length) parts.push(`${stageMoved ? 'changed' : 'Changed'} the ${listText(changes)}`);
    log = { action: stageMoved ? 'case.stage' : 'case.update', caseId: prev.id, target: prev.id, text: parts.join(' and ') };
  }
  await save([record], log);
  navigate(`#case/${record.id}`);
  toast(prev ? 'Case saved' : 'Case opened');
}

function locate(button) {
  const form = button.closest('form');
  const hint = document.getElementById('c-gps-hint');
  if (!navigator.geolocation) {
    hint.textContent = "This browser can't find your location. Type the position instead.";
    return;
  }
  button.disabled = true;
  hint.textContent = 'Finding where you are…';
  navigator.geolocation.getCurrentPosition((pos) => {
    form.elements.lat.value = pos.coords.latitude.toFixed(6);
    form.elements.lng.value = pos.coords.longitude.toFixed(6);
    hint.textContent = `Found, to within about ${Math.round(pos.coords.accuracy)} metres.`;
    button.disabled = false;
  }, () => {
    hint.textContent = "Couldn't get your location. Check that location is allowed for this site, or type the position.";
    button.disabled = false;
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

function changeStageSheet(id) {
  const c = getCase(id);
  if (!c) return;
  openSheet({
    title: 'Change the stage',
    body: html`<fieldset class="field">
        <legend class="visually-hidden">Stage</legend>
        <div class="pills pills-stack">${Object.keys(STAGES).map((key) => html`<label class="pill"><input type="radio" name="stage" value="${key}" data-input="stage-pill"${checked(key === c.stage)}><span><strong>${STAGES[key].label}</strong><span class="muted small">${STAGES[key].hint}</span></span></label>`)}</div>
      </fieldset>
      <div class="field" id="sheet-outcome"${raw(c.stage === 'closed' ? '' : ' hidden')}>
        <label for="st-outcome">Outcome</label>
        <select id="st-outcome" name="outcome"><option value="">Not recorded</option>${options(OUTCOMES, c.outcome)}</select>
      </div>`,
    submitLabel: 'Save',
    async onSubmit(form) {
      const stage = form.elements.stage.value;
      const outcome = stage === 'closed' ? form.elements.outcome.value : '';
      if (stage === c.stage && outcome === c.outcome) return undefined;
      const text = stage === c.stage ? `Recorded the outcome: ${OUTCOMES[outcome] || 'not recorded'}` : `Moved from ${STAGES[c.stage].label} to ${STAGES[stage].label}${outcome ? ` (${OUTCOMES[outcome]})` : ''}`;
      await save([Object.assign({}, c, { stage, outcome, closedOn: stage === 'closed' ? c.closedOn || today() : '' })], { action: 'case.stage', caseId: c.id, target: c.id, text });
      toast(`Stage: ${STAGES[stage].label}`);
      return undefined;
    },
  });
}

async function deleteCase(id) {
  const c = getCase(id);
  if (!c) return;
  const k = kids(c.id);
  const ok = await confirmAction({
    title: `Delete ${c.ref}?`,
    text: `The case and everything in it (${plural(k.evidence.length, 'evidence item')}, ${plural(k.person.length, 'person', 'people')}, ${plural(k.entry.length, 'diary entry', 'diary entries')}) will be deleted from this device, and from other people's Casebooks when you next share with them. Copies already in Casebook files stay in those files. The activity log keeps a note that it was deleted.`,
    confirmLabel: 'Delete the case',
    typed: 'DELETE',
  });
  if (!ok) return;
  const children = ['animal', 'person', 'evidence', 'entry', 'task'].flatMap((kind) => k[kind]);
  const shas = k.evidence.map((e) => e.sha256);
  await withBusy('Deleting…', async () => {
    await save([tombstone(c), ...children.map(tombstone)], { action: 'case.delete', caseId: c.id, target: c.id, text: `Deleted the case ${c.ref}` });
    await dropUnusedFiles(shas);
  });
  navigate('#cases', true);
  toast('Case deleted');
}

async function toggleChecklist(button) {
  const c = getCase(button.dataset.case);
  const key = button.dataset.key;
  if (!c || !has(CHECKLIST_LABELS, key)) return;
  const on = !c.checklist[key];
  const list = Object.assign({}, c.checklist);
  if (on) list[key] = true;
  else delete list[key];
  await save([Object.assign({}, c, { checklist: list })], { action: 'case.update', caseId: c.id, target: c.id, text: `${on ? 'Ticked' : 'Unticked'} “${CHECKLIST_LABELS[key]}”` });
  render();
}

const CHECKLIST_LABELS = Object.fromEntries(checklist({ legal: {}, checklist: {} }, []).map((i) => [i.key, i.label]));

/* Animals, people, diary and tasks ------------------------------------------ */

function childBase(caseId, kind) {
  const c = getCase(caseId);
  return { id: newId(), kind, caseId, example: Boolean(c && c.example) };
}

function deleteChild(r, label) {
  return async () => {
    const ok = await confirmAction({ title: `Delete this ${label}?`, text: 'It will be removed from the case. The activity log keeps a note that it was deleted.', confirmLabel: 'Delete' });
    if (!ok) return;
    await save([tombstone(r)], { action: `${r.kind}.delete`, caseId: r.caseId, target: r.id, text: `Deleted ${label === 'person' ? ROLES[r.role].a : `a ${label}`}` });
    closeSheet();
    render();
  };
}

function animalSheet(caseId, animal) {
  const a = animal || { species: 'dog', sex: 'unknown', count: 1, condition: 'injured', name: '', description: '', injuries: '', notes: '' };
  openSheet({
    title: animal ? 'Edit animal' : 'Add an animal',
    body: html`<div class="field-row">
        <div class="field"><label for="a-species">Animal</label><select id="a-species" name="species">${options(SPECIES, a.species)}</select></div>
        <div class="field"><label for="a-count">How many</label><input id="a-count" name="count" type="number" min="1" max="9999" value="${a.count}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="a-name">Name <span class="optional">(if it has one)</span></label><input id="a-name" name="name" type="text" maxlength="80" value="${a.name}"></div>
        <div class="field"><label for="a-sex">Sex</label><select id="a-sex" name="sex">${options(SEXES, a.sex)}</select></div>
      </div>
      <fieldset class="field"><legend>Condition</legend>${radioPills('condition', CONDITIONS, a.condition, (x) => x.label)}</fieldset>
      <div class="field"><label for="a-desc">How to recognise it</label><textarea id="a-desc" name="description" rows="2" maxlength="1000" placeholder="Colour, markings, ear notch, collar…">${a.description}</textarea></div>
      <div class="field"><label for="a-inj">Injuries or harm</label><textarea id="a-inj" name="injuries" rows="3" maxlength="4000">${a.injuries}</textarea></div>
      <div class="field"><label for="a-notes">Notes</label><textarea id="a-notes" name="notes" rows="2" maxlength="4000">${a.notes}</textarea></div>`,
    submitLabel: animal ? 'Save' : 'Add animal',
    onDelete: animal ? deleteChild(animal, 'animal') : null,
    async onSubmit(form) {
      const f = form.elements;
      const record = Object.assign({}, animal || childBase(caseId, 'animal'), {
        species: f.species.value, count: f.count.value, name: f.name.value.trim(), sex: f.sex.value, condition: f.condition.value,
        description: f.description.value.trim(), injuries: f.injuries.value.trim(), notes: f.notes.value.trim(),
      });
      const label = `${SPECIES[record.species].toLowerCase()}${record.name ? ` (${record.name})` : ''}`;
      await save([record], { action: animal ? 'animal.update' : 'animal.add', caseId: record.caseId, target: record.id, text: `${animal ? 'Updated' : 'Added'} an animal: ${label}` });
      return undefined;
    },
  });
}

function personSheet(caseId, person) {
  const p = person || { role: 'witness', name: '', phone: '', address: '', notes: '', confidential: ROLES.witness.confidential };
  openSheet({
    title: person ? 'Edit person' : 'Add a person',
    body: html`<div class="field"><label for="p-role">Role in the case</label><select id="p-role" name="role" data-input="role-select">${options(ROLES, p.role, (r) => r.label)}</select></div>
      <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" type="text" maxlength="120" value="${p.name}" spellcheck="false"></div>
      <div class="field-row">
        <div class="field"><label for="p-phone">Phone</label><input id="p-phone" name="phone" type="tel" maxlength="40" value="${p.phone}" spellcheck="false"></div>
      </div>
      <div class="field"><label for="p-address">Address</label><input id="p-address" name="address" type="text" maxlength="300" value="${p.address}" spellcheck="false"></div>
      <div class="field"><label for="p-notes">Notes</label><textarea id="p-notes" name="notes" rows="3" maxlength="4000" placeholder="What they saw or did, how to reach them, anything to be careful about">${p.notes}</textarea></div>
      <label class="check"><input type="checkbox" name="confidential"${checked(p.confidential)}><span><strong>Confidential.</strong> Keep this person out of shared files and reports unless I choose to include them.</span></label>`,
    submitLabel: person ? 'Save' : 'Add person',
    onDelete: person ? deleteChild(person, 'person') : null,
    async onSubmit(form) {
      const f = form.elements;
      if (!f.name.value.trim()) {
        sheetError('Add a name, or a description like "Shopkeeper next door".');
        f.name.focus();
        return false;
      }
      const record = Object.assign({}, person || childBase(caseId, 'person'), {
        role: f.role.value, name: f.name.value.trim(), phone: f.phone.value.trim(), address: f.address.value.trim(),
        notes: f.notes.value.trim(), confidential: f.confidential.checked,
      });
      await save([record], { action: person ? 'person.update' : 'person.add', caseId: record.caseId, target: record.id, text: `${person ? 'Updated the details of' : 'Added'} ${ROLES[record.role].a}${record.confidential ? ' (confidential)' : ''}` });
      return undefined;
    },
  });
}

function entrySheet(caseId, entry) {
  const e = entry || { type: 'note', date: today(), time: nowTime(), text: '' };
  openSheet({
    title: entry ? 'Edit diary entry' : 'Add to the diary',
    body: html`<fieldset class="field"><legend>What kind</legend>${radioPills('type', ENTRY_TYPES, e.type, (x) => x.label)}</fieldset>
      <div class="field-row">
        <div class="field"><label for="d-date">Date</label><input id="d-date" name="date" type="date" value="${e.date}"></div>
        <div class="field"><label for="d-time">Time</label><input id="d-time" name="time" type="time" value="${e.time}"></div>
      </div>
      <div class="field"><label for="d-text">What happened</label><textarea id="d-text" name="text" rows="6" maxlength="20000">${e.text}</textarea></div>`,
    submitLabel: entry ? 'Save' : 'Add entry',
    onDelete: entry ? deleteChild(entry, 'diary entry') : null,
    async onSubmit(form) {
      const f = form.elements;
      if (!f.text.value.trim()) {
        sheetError('Write what happened.');
        f.text.focus();
        return false;
      }
      const record = Object.assign({}, entry || childBase(caseId, 'entry'), { type: f.type.value, date: f.date.value || today(), time: f.time.value, text: f.text.value.trim() });
      await save([record], { action: entry ? 'entry.update' : 'entry.add', caseId: record.caseId, target: record.id, text: `${entry ? 'Edited' : 'Added'} a diary entry: ${ENTRY_TYPES[record.type].label}, ${fmtDate(record.date)}` });
      return undefined;
    },
  });
}

function taskSheet(caseId, task) {
  const t = task || { title: '', due: '', done: false };
  openSheet({
    title: task ? 'Edit task' : 'Add a task',
    body: html`<div class="field"><label for="t-title">Task</label><input id="t-title" name="title" type="text" maxlength="300" value="${t.title}" placeholder="For example: Collect the post-mortem report"></div>
      <div class="field-row"><div class="field"><label for="t-due">Due <span class="optional">(optional)</span></label><input id="t-due" name="due" type="date" value="${t.due}"></div></div>
      ${task ? html`<label class="check"><input type="checkbox" name="done"${checked(t.done)}><span>Done</span></label>` : ''}`,
    submitLabel: task ? 'Save' : 'Add task',
    onDelete: task ? deleteChild(task, 'task') : null,
    async onSubmit(form) {
      const f = form.elements;
      if (!f.title.value.trim()) {
        sheetError('Say what needs doing.');
        f.title.focus();
        return false;
      }
      const done = f.done ? f.done.checked : false;
      const record = Object.assign({}, task || childBase(caseId, 'task'), { title: f.title.value.trim(), due: f.due.value, done, doneOn: done ? (task && task.doneOn) || today() : '' });
      await save([record], { action: task ? 'task.update' : 'task.add', caseId: record.caseId, target: record.id, text: task ? 'Edited a task' : `Added a task${record.due ? `, due ${fmtDate(record.due)}` : ''}` });
      return undefined;
    },
  });
}

async function toggleTask(input) {
  const task = getRecord(input.dataset.id);
  if (!task) return;
  const done = input.checked;
  await save([Object.assign({}, task, { done, doneOn: done ? today() : '' })], { action: 'task.done', caseId: task.caseId, target: task.id, text: done ? 'Completed a task' : 'Reopened a task' });
  render();
}

async function saveLegal(form) {
  const c = getCase(form.dataset.id);
  if (!c) return;
  const legal = {};
  for (const key of Object.keys(LEGAL_FIELDS)) legal[key] = form.elements[key].value.trim();
  const next = clean(Object.assign({}, c, { legal }));
  const labels = Object.fromEntries(Object.entries(LEGAL_FIELDS).map(([key, field]) => [key, inSentence(field.label)]));
  const changes = describeChanges(c.legal, next.legal, labels);
  if (!changes.length) {
    toast('No changes to save');
    return;
  }
  await save([Object.assign({}, c, { legal })], { action: 'legal.update', caseId: c.id, target: c.id, text: `Updated the legal details: ${listText(changes)}` });
  toast('Legal details saved');
  render();
}

/* Adding evidence ---------------------------------------------------------- */

async function onEvidenceChosen(input) {
  pickingFile = false;
  const caseId = input.dataset.case;
  const files = Array.from(input.files || []);
  input.value = '';
  const c = getCase(caseId);
  if (!c || !files.length) return;
  const items = [];
  try {
    await withBusy('Fingerprinting…', async (progress) => {
      for (const [i, file] of files.entries()) {
        const label = `Fingerprinting ${file.name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ''}`;
        progress(0, file.size, label);
        const sha256 = await fingerprintBlob(file, (done, total) => progress(done, total, label));
        let info = null;
        try {
          info = await readPhotoInfo(file);
        } catch (err) {
          info = null;
        }
        const thumb = await makeThumb(file);
        const modified = file.lastModified ? new Date(file.lastModified) : null;
        items.push({
          file,
          sha256,
          thumb,
          type: guessType(file),
          date: info && info.date ? info.date : modified ? localDate(modified.toISOString()) : '',
          time: info && info.time ? info.time : modified ? `${String(modified.getHours()).padStart(2, '0')}:${String(modified.getMinutes()).padStart(2, '0')}` : '',
          dateFrom: info && info.date ? 'camera' : modified ? 'file' : '',
          gps: info && info.lat != null ? `${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}` : '',
          already: kids(caseId).evidence.find((e) => e.sha256 === sha256),
          elsewhere: idx().evidence.find((e) => e.sha256 === sha256 && e.caseId !== caseId),
        });
      }
    });
  } catch (err) {
    toast(`Couldn't read that file: ${messageFor(err)}`);
    return;
  }
  evidenceIntakeSheet(c, items);
}

function evidenceIntakeSheet(c, items) {
  const fresh = items.filter((it) => !it.already);
  openSheet({
    title: items.length === 1 ? 'Add this file as evidence' : `Add ${items.length} files as evidence`,
    wide: true,
    body: html`<p class="muted small">Fingerprints are worked out from the files exactly as they are. Check the details, then add them: the files are encrypted as they're saved.</p>
      <ol class="intake-list">${items.map((it, i) => html`<li class="intake${it.already ? ' is-skipped' : ''}">
        <div class="intake-head">
          <span class="evidence-thumb">${it.thumb ? html`<img src="${it.thumb}" alt="">` : icon(EVIDENCE_TYPES[it.type].icon)}</span>
          <div class="intake-file">
            <p class="intake-name">${it.file.name}</p>
            <p class="muted small">${fmtBytes(it.file.size)} · SHA-256 <span class="hash-inline">${shortHash(it.sha256)}</span></p>
            ${it.already ? html`<p class="small tone-warn">Already in this case as “${it.already.title || it.already.fileName}”. It won't be added again.</p>` : ''}
            ${!it.already && it.elsewhere ? html`<p class="small muted">The same file is also in ${getCase(it.elsewhere.caseId) ? getCase(it.elsewhere.caseId).ref : 'another case'}.</p>` : ''}
          </div>
        </div>
        ${it.already ? '' : html`<div class="field-row">
          <div class="field"><label for="ev-title-${i}">Title</label><input id="ev-title-${i}" name="title-${i}" type="text" maxlength="200" value="${it.file.name.replace(/\.[^.]+$/, '')}"></div>
          <div class="field"><label for="ev-type-${i}">Type</label><select id="ev-type-${i}" name="type-${i}">${options(EVIDENCE_TYPES, it.type, (t) => t.label)}</select></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="ev-date-${i}">Taken or made on</label><input id="ev-date-${i}" name="date-${i}" type="date" value="${it.date}"></div>
          <div class="field"><label for="ev-time-${i}">Time</label><input id="ev-time-${i}" name="time-${i}" type="time" value="${it.time}"></div>
        </div>
        ${it.dateFrom ? html`<p class="hint">${it.dateFrom === 'camera' ? "Date and time from the photo's camera data." : 'Date and time of the file. If it was copied or sent on, this may be later than when it was taken.'}</p>` : ''}
        <div class="field"><label for="ev-place-${i}">Where</label><input id="ev-place-${i}" name="place-${i}" type="text" maxlength="300" value="${it.gps ? `GPS ${it.gps}` : ''}"></div>
        ${it.gps ? html`<p class="hint">Position from the photo's camera data.</p>` : ''}`}
      </li>`)}</ol>
      ${fresh.length ? html`<div class="field"><label for="ev-by">Taken or collected by${fresh.length > 1 ? html` <span class="optional">(for all of them)</span>` : ''}</label><input id="ev-by" name="by" type="text" maxlength="80" value="${session.settings.name}" spellcheck="false"><p class="hint">If someone sent you the files, put their name or role here.</p></div>
      <div class="field"><label for="ev-notes">Notes${fresh.length > 1 ? html` <span class="optional">(for all of them)</span>` : ''}</label><textarea id="ev-notes" name="notes" rows="2" maxlength="4000" placeholder="How you got the files, from whom, and anything about the original device"></textarea></div>` : ''}`,
    submitLabel: fresh.length ? (fresh.length === 1 ? 'Add to the case' : `Add ${fresh.length} files`) : '',
    async onSubmit(form) {
      const f = form.elements;
      const records = [];
      const logs = [];
      await withBusy('Encrypting…', async (progress) => {
        for (const [i, it] of items.entries()) {
          if (it.already) continue;
          const label = `Encrypting ${it.file.name}`;
          if (!(await hasFile(session.keys, chunkStore, { sha256: it.sha256, size: it.file.size }))) {
            await saveFile(session.keys, chunkStore, it.file, it.sha256, (done, total) => progress(done, total, label));
          }
          const type = f[`type-${i}`].value;
          const record = Object.assign(childBase(c.id, 'evidence'), {
            type,
            title: f[`title-${i}`].value.trim() || it.file.name,
            capturedDate: f[`date-${i}`].value,
            capturedTime: f[`time-${i}`].value,
            capturedBy: f.by.value.trim(),
            place: f[`place-${i}`].value.trim(),
            notes: f.notes.value.trim(),
            fileName: it.file.name,
            mime: it.file.type || 'application/octet-stream',
            size: it.file.size,
            sha256: it.sha256,
            thumb: it.thumb,
          });
          records.push(record);
          logs.push({ action: 'evidence.add', caseId: c.id, target: record.id, text: `Added ${inSentence(EVIDENCE_TYPES[type].label)} “${it.file.name}” (${fmtBytes(it.file.size)}, SHA-256 ${it.sha256})` });
        }
        await save(records, logs);
      });
      toast(records.length === 1 ? 'Evidence added' : `${records.length} files added`);
      if (parseRoute(routeHash).tab !== 'evidence') navigate(`#case/${c.id}/evidence`);
      return undefined;
    },
  });
}

function itemSheet(caseId, item) {
  const it = item || { title: '', notes: '', capturedDate: today(), capturedTime: '', capturedBy: session.settings.name, place: '' };
  openSheet({
    title: item ? 'Edit physical item' : 'Record a physical item',
    body: html`<p class="muted small">For evidence that isn't a file: a food sample, a weapon, a collar, a paper document. Record where it is and who has it.</p>
      <div class="field"><label for="i-title">What it is</label><input id="i-title" name="title" type="text" maxlength="200" value="${it.title}"></div>
      <div class="field-row">
        <div class="field"><label for="i-date">Collected on</label><input id="i-date" name="date" type="date" value="${it.capturedDate}"></div>
        <div class="field"><label for="i-by">Collected by</label><input id="i-by" name="by" type="text" maxlength="80" value="${it.capturedBy}"></div>
      </div>
      <div class="field"><label for="i-place">Where it was found</label><input id="i-place" name="place" type="text" maxlength="300" value="${it.place}"></div>
      <div class="field"><label for="i-notes">Where it is now and who has it</label><textarea id="i-notes" name="notes" rows="3" maxlength="4000">${it.notes}</textarea></div>`,
    submitLabel: item ? 'Save' : 'Add item',
    onDelete: item ? () => deleteEvidence(item) : null,
    async onSubmit(form) {
      const f = form.elements;
      if (!f.title.value.trim()) {
        sheetError('Say what the item is.');
        return false;
      }
      const record = Object.assign({}, item || childBase(caseId, 'evidence'), { type: 'item', title: f.title.value.trim(), capturedDate: f.date.value, capturedBy: f.by.value.trim(), place: f.place.value.trim(), notes: f.notes.value.trim() });
      await save([record], { action: item ? 'evidence.update' : 'evidence.add', caseId: record.caseId, target: record.id, text: `${item ? 'Updated' : 'Recorded'} a physical item` });
      if (!item && parseRoute(routeHash).tab !== 'evidence') navigate(`#case/${caseId}/evidence`);
      return undefined;
    },
  });
}

/* One piece of evidence ---------------------------------------------------- */

function custodyEntries(ev) {
  return kids(ev.caseId).log.filter((e) => e.target === ev.id || ((e.action === 'case.share' || e.action === 'case.receive') && e.at >= ev.created));
}

async function openEvidence(id) {
  const ev = getRecord(id);
  if (!ev) return;
  if (ev.type === 'item') {
    itemSheet(ev.caseId, ev);
    return;
  }
  const here = ev.sha256 ? await fileHere(ev) : false;
  const last = lastCheck(ev);
  const type = EVIDENCE_TYPES[ev.type];
  openSheet({
    title: ev.title || ev.fileName || type.label,
    wide: true,
    body: html`<div class="ev-preview" id="ev-preview">
        ${ev.thumb ? html`<img src="${ev.thumb}" alt="Preview of ${ev.title || ev.fileName}">` : html`<span class="ev-preview-icon">${icon(type.icon)}</span>`}
        ${here && isViewable(ev.mime) ? html`<button class="btn btn-sm btn-primary ev-open" type="button" data-action="ev-view" data-id="${ev.id}">${icon('eye')} ${ev.mime.startsWith('image/') ? 'View full size' : 'Play'}</button>` : ''}
      </div>
      ${!here && ev.sha256 ? notice('warn', 'warn', html`<p><strong>The file isn't on this device.</strong> Its details and fingerprint arrived without the file. Ask for a Casebook file that includes evidence files.</p>`) : ''}
      <dl class="facts">
        ${fact('Type', type.label)}
        ${fact('Taken or made', [ev.capturedDate ? fmtDate(ev.capturedDate) : '', ev.capturedTime ? fmtTime(ev.capturedTime) : ''].filter(Boolean).join(', ') + (ev.capturedBy ? ` by ${ev.capturedBy}` : ''))}
        ${fact('Where', ev.place)}
        ${fact('File', [ev.fileName, fmtBytes(ev.size), ev.mime].filter(Boolean).join(' · '))}
        ${fact('Added', `${fmtMoment(ev.created)}${ev.createdBy ? ` by ${ev.createdBy}` : ''}`)}
        ${fact('Notes', ev.notes)}
      </dl>
      <div class="hash-box">
        <p class="eyebrow">SHA-256 fingerprint</p>
        <p class="hash" id="ev-hash">${groupedHash(ev.sha256)}</p>
        <div class="btn-row">
          <button class="btn btn-sm btn-outline" type="button" data-action="copy" data-copy="${ev.sha256}">${icon('copy')} Copy</button>
          ${here ? html`<button class="btn btn-sm btn-outline" type="button" data-action="ev-check" data-id="${ev.id}">${icon('fingerprint')} Check it now</button>` : ''}
        </div>
        <p class="small" id="ev-check-result">${last ? (last.action === 'evidence.mismatch' ? html`<span class="tone-bad">${icon('warn')} Did not match when checked ${fmtMoment(last.at)}.</span>` : html`<span class="tone-good">${icon('check')} Matched when checked ${fmtMoment(last.at)}${last.by ? ` by ${last.by}` : ''}.</span>`) : 'Not checked since it was added. The fingerprint was worked out from the file when it was added.'}</p>
      </div>
      <section class="section">
        <div class="section-head"><h3>History and custody</h3><button class="btn btn-quiet btn-sm" type="button" data-action="ev-custody" data-id="${ev.id}">${icon('plus')} Add a note</button></div>
        <div id="ev-history">${activityList(custodyEntries(ev), false)}</div>
      </section>
      <div class="btn-row">
        <button class="btn btn-outline btn-sm" type="button" data-action="ev-edit" data-id="${ev.id}">${icon('edit')} Edit details</button>
        ${here ? html`<button class="btn btn-outline btn-sm" type="button" data-action="ev-copy" data-id="${ev.id}">${icon('download')} Save a copy</button>` : ''}
      </div>`,
    onDelete: () => deleteEvidence(ev),
  });
}

async function viewEvidenceFile(id) {
  const ev = getRecord(id);
  if (!ev) return;
  let blob;
  try {
    blob = await withBusy('Decrypting…', (progress) => loadFile(session.keys, chunkStore, ev, (done, total) => progress(done, total)));
  } catch (err) {
    toast(messageFor(err));
    return;
  }
  const box = document.getElementById('ev-preview');
  if (!box) return;
  const url = URL.createObjectURL(blob);
  onSheetClose(() => URL.revokeObjectURL(url));
  let media;
  if (ev.mime.startsWith('image/')) {
    media = document.createElement('img');
    media.alt = ev.title || ev.fileName;
  } else {
    media = document.createElement(ev.mime.startsWith('audio/') ? 'audio' : 'video');
    media.controls = true;
    media.playsInline = true;
  }
  media.src = url;
  box.replaceChildren(media);
  box.classList.add('is-open');
}

async function checkEvidence(id) {
  const ev = getRecord(id);
  if (!ev) return;
  const result = await withBusy('Checking the fingerprint…', (progress) => checkFile(session.keys, chunkStore, ev, (done, total) => progress(done, total)));
  const ok = result.ok;
  const text = ok ? 'Checked the fingerprint: it matches'
    : result.problem === 'missing' ? 'Checked the fingerprint: the file is missing from this device'
      : `Checked the fingerprint: it DOES NOT match${result.actual ? ` (now ${result.actual})` : ' (the stored file is damaged)'}`;
  await logOnly({ action: ok ? 'evidence.check' : 'evidence.mismatch', caseId: ev.caseId, target: ev.id, text });
  const el = document.getElementById('ev-check-result');
  if (el) setHTML(el, ok ? html`<span class="tone-good">${icon('check')} Matches. The file is exactly as it was when it was added.</span>` : html`<span class="tone-bad">${icon('warn')} ${text}.</span>`);
  const history = document.getElementById('ev-history');
  if (history) setHTML(history, activityList(custodyEntries(ev), false));
  return ok;
}

async function checkAll(caseId) {
  const list = (caseId ? kids(caseId).evidence : idx().evidence).filter((e) => e.sha256);
  let matched = 0;
  let missing = 0;
  const failed = [];
  const logs = [];
  await withBusy('Checking fingerprints…', async (progress) => {
    for (const [i, ev] of list.entries()) {
      const label = `Checking ${i + 1} of ${list.length}: ${ev.fileName || ev.title}`;
      if (!(await fileHere(ev))) {
        missing++;
        continue;
      }
      const result = await checkFile(session.keys, chunkStore, ev, (done, total) => progress(done, total, label));
      if (result.ok) matched++;
      else failed.push(ev);
      logs.push({ action: result.ok ? 'evidence.check' : 'evidence.mismatch', caseId: ev.caseId, target: ev.id, text: result.ok ? 'Checked the fingerprint: it matches' : 'Checked the fingerprint: it DOES NOT match' });
    }
  });
  if (logs.length) await logOnly(logs);
  openSheet({
    title: failed.length ? 'Some files did not match' : 'Fingerprints checked',
    body: html`${failed.length
      ? notice('warn', 'warn', html`<p><strong>${plural(failed.length, 'file')} did not match ${failed.length === 1 ? 'its' : 'their'} fingerprint.</strong> The stored copy has been damaged or changed. Use the original from the device it came from.</p><ul>${failed.map((e) => html`<li>${e.title || e.fileName}</li>`)}</ul>`)
      : notice('', 'check', html`<p><strong>${plural(matched, 'file')} checked: every one matches.</strong> Each file is exactly as it was when it was added.</p>`)}
      ${missing ? html`<p class="muted small">${plural(missing, 'file')} ${missing === 1 ? "isn't" : "aren't"} on this device, so ${missing === 1 ? 'it' : 'they'} couldn't be checked.</p>` : ''}`,
  });
  render();
}

async function saveEvidenceCopy(id) {
  const ev = getRecord(id);
  if (!ev) return;
  const ok = await confirmAction({
    title: 'Save an unencrypted copy?',
    text: 'The copy is saved to this device as an ordinary file, outside the Casebook, so anyone who can open your downloads can see it. Delete it when you no longer need it.',
    confirmLabel: 'Save the copy',
    danger: false,
  });
  if (!ok) return;
  let blob;
  try {
    blob = await withBusy('Decrypting…', (progress) => loadFile(session.keys, chunkStore, ev, (done, total) => progress(done, total)));
  } catch (err) {
    toast(messageFor(err));
    return;
  }
  downloadBlob(blob, ev.fileName || 'evidence');
  await logOnly({ action: 'evidence.copy', caseId: ev.caseId, target: ev.id, text: `Saved an unencrypted copy of “${ev.fileName}”` });
}

function custodySheet(id) {
  const ev = getRecord(id);
  if (!ev) return;
  openSheet({
    title: 'Add a custody note',
    body: html`<p class="muted small">Record who handled the evidence or the original device, when and why: for example, "Original phone shown to the investigating officer at the police station." Notes can't be changed later and travel with the case, so don't name confidential people here.</p>
      <div class="field"><label for="cn-text">Note</label><textarea id="cn-text" name="text" rows="4" maxlength="480"></textarea></div>`,
    submitLabel: 'Add the note',
    async onSubmit(form) {
      const text = form.elements.text.value.trim();
      if (!text) {
        sheetError('Write the note.');
        return false;
      }
      await logOnly({ action: 'evidence.custody', caseId: ev.caseId, target: ev.id, text });
      toast('Note added');
      openEvidence(ev.id);
      return false;
    },
  });
}

function evidenceEditSheet(id) {
  const ev = getRecord(id);
  if (!ev) return;
  openSheet({
    title: 'Edit evidence details',
    body: html`<p class="muted small">The file itself can't be changed. Only the details about it.</p>
      <div class="field"><label for="ee-title">Title</label><input id="ee-title" name="title" type="text" maxlength="200" value="${ev.title}"></div>
      <div class="field"><label for="ee-type">Type</label><select id="ee-type" name="type">${options(EVIDENCE_TYPES, ev.type, (t) => t.label)}</select></div>
      <div class="field-row">
        <div class="field"><label for="ee-date">Taken or made on</label><input id="ee-date" name="date" type="date" value="${ev.capturedDate}"></div>
        <div class="field"><label for="ee-time">Time</label><input id="ee-time" name="time" type="time" value="${ev.capturedTime}"></div>
      </div>
      <div class="field"><label for="ee-by">Taken or collected by</label><input id="ee-by" name="by" type="text" maxlength="80" value="${ev.capturedBy}"></div>
      <div class="field"><label for="ee-place">Where</label><input id="ee-place" name="place" type="text" maxlength="300" value="${ev.place}"></div>
      <div class="field"><label for="ee-notes">Notes</label><textarea id="ee-notes" name="notes" rows="3" maxlength="4000">${ev.notes}</textarea></div>`,
    submitLabel: 'Save',
    async onSubmit(form) {
      const f = form.elements;
      const next = Object.assign({}, ev, { title: f.title.value.trim(), type: f.type.value, capturedDate: f.date.value, capturedTime: f.time.value, capturedBy: f.by.value.trim(), place: f.place.value.trim(), notes: f.notes.value.trim() });
      const changes = describeChanges(ev, clean(next), { title: 'title', type: 'type', capturedDate: 'date', capturedTime: 'time', capturedBy: 'who took it', place: 'place', notes: 'notes' });
      if (changes.length) await save([next], { action: 'evidence.update', caseId: ev.caseId, target: ev.id, text: `Changed the ${listText(changes)} of “${ev.fileName || ev.title}”` });
      openEvidence(ev.id);
      return false;
    },
  });
}

async function deleteEvidence(ev) {
  const ok = await confirmAction({
    title: 'Delete this evidence?',
    text: ev.sha256 ? "The encrypted file and its details will be deleted from this device. Copies already shared with others aren't affected until they receive this change. The activity log keeps the file's fingerprint." : 'The record will be deleted. The activity log keeps a note of it.',
    confirmLabel: 'Delete',
    typed: ev.sha256 ? 'DELETE' : '',
  });
  if (!ok) return;
  await withBusy('Deleting…', async () => {
    await save([tombstone(ev)], { action: 'evidence.delete', caseId: ev.caseId, target: ev.id, text: `Deleted ${ev.fileName ? `“${ev.fileName}”` : 'a physical item'}${ev.sha256 ? ` (SHA-256 ${ev.sha256})` : ''}` });
    await dropUnusedFiles([ev.sha256]);
  });
  closeSheet();
  render();
  toast('Evidence deleted');
}

/* All evidence ------------------------------------------------------------- */

const evidenceFilter = { query: '', type: '' };

function viewEvidence() {
  const all = idx().evidence;
  const files = new Map();
  for (const e of all) if (e.sha256) files.set(e.sha256, e.size);
  const size = Array.from(files.values()).reduce((a, b) => a + b, 0);
  return html`<div class="view">
    <header class="view-head">
      <div>
        <h1 tabindex="-1">Evidence</h1>
        <p class="lead">${plural(files.size, 'file')} (${fmtBytes(size)}) and ${plural(all.filter((e) => !e.sha256).length, 'physical item')} across ${plural(new Set(all.map((e) => e.caseId)).size, 'case')}.</p>
      </div>
      ${files.size ? html`<button class="btn btn-outline" type="button" data-action="check-all">${icon('fingerprint')} Check every fingerprint</button>` : ''}
    </header>
    <div class="filters" role="search">
      <div class="search-box">${icon('search')}
        <label class="visually-hidden" for="ev-search">Search evidence</label>
        <input id="ev-search" type="search" value="${evidenceFilter.query}" placeholder="Search titles, file names, fingerprints…" data-input="evidence-search" autocomplete="off" spellcheck="false">
      </div>
      <div class="filter-row">
        <label class="select-chip"><span class="visually-hidden">Type</span><select data-input="evidence-filter"><option value="">All types</option>${options(EVIDENCE_TYPES, evidenceFilter.type, (t) => t.label)}</select></label>
      </div>
    </div>
    <div id="evidence-results">${evidenceResults()}</div>
  </div>`;
}

function evidenceResults() {
  const q = evidenceFilter.query.trim().toLowerCase();
  const list = idx().evidence.filter((e) => (!evidenceFilter.type || e.type === evidenceFilter.type)
    && (!q || [e.title, e.fileName, e.notes, e.sha256, e.capturedBy, e.place].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => collator.compare(b.created, a.created));
  if (!idx().evidence.length) return html`<div class="empty"><span class="empty-icon">${icon('fingerprint')}</span><p>No evidence yet. Open a case and add files from its Evidence tab.</p></div>`;
  if (!list.length) return html`<div class="empty"><p>Nothing matches.</p></div>`;
  const groups = new Map();
  for (const e of list) {
    if (!groups.has(e.caseId)) groups.set(e.caseId, []);
    groups.get(e.caseId).push(e);
  }
  return html`${Array.from(groups, ([caseId, items]) => {
    const c = getCase(caseId);
    return html`<section class="section">
      <h2 class="group-title"><a href="#case/${caseId}/evidence">${c.ref} · ${c.title}</a></h2>
      <ul class="evidence-grid">${items.map(evidenceCard)}</ul>
    </section>`;
  })}`;
}

/* Sharing and combining ---------------------------------------------------- */

function sharedFiles() {
  return idx().logs.filter((e) => e.action === 'file.export' || e.action === 'file.import').slice(0, 12);
}

function viewShare() {
  const last = session.settings.lastBackup;
  return html`<div class="view">
    <header class="view-head"><div>
      <h1 tabindex="-1">Share and combine</h1>
      <p class="lead">Cases move between devices as encrypted Casebook files. Each file is locked with its own passphrase: send the file one way and tell the passphrase another, in person or by phone.</p>
    </div></header>
    <div class="grid-2">
      <section class="card section">
        <span class="card-icon">${icon('share')}</span>
        <h2>Send cases to a colleague</h2>
        <p class="muted">Choose the cases, whether to include evidence files and confidential people, and a passphrase for the file. Then send it on WhatsApp, by email or on a USB stick.</p>
        <div class="btn-row"><button class="btn btn-primary" type="button" data-action="export">${icon('share')} Create a Casebook file</button></div>
      </section>
      <section class="card section">
        <span class="card-icon">${icon('upload')}</span>
        <h2>Add cases from a file</h2>
        <p class="muted">Combine a colleague's file, or your own backup, with the cases here. Every evidence file's fingerprint is checked as it arrives.</p>
        <div class="btn-row"><label class="btn btn-primary file-btn">${icon('upload')} Choose a Casebook file
          <input class="visually-hidden" type="file" data-input="import-file">
        </label></div>
      </section>
    </div>
    <section class="card section">
      <div class="section-head"><h2>Back up everything</h2>${last ? html`<span class="muted small">Last backup ${relDay(localDate(last))}</span>` : html`<span class="chip chip-warn">${icon('warn')}No backup yet</span>`}</div>
      <p class="muted">The cases live only in this browser. If its data is cleared, or the device is lost or broken, a backup is the only way to get them back. Keep backups somewhere other than this device: another computer, a USB stick in a safe place, or cloud storage. They stay encrypted wherever they are.</p>
      <div class="btn-row"><button class="btn btn-outline" type="button" data-action="backup">${icon('download')} Create a backup</button></div>
    </section>
    <section class="card section">
      <h2>How combining works</h2>
      <ul class="bullets">
        <li>Every case, animal, person, file and diary entry has its own identity, so the same case from two people lines up record by record.</li>
        <li>Where both copies changed the same record, the most recent change is kept. Nothing else is overwritten.</li>
        <li>A record only disappears when someone deliberately deleted it, and the activity log says who and when.</li>
        <li>Activity logs are joined, not replaced, so the history from every device is kept.</li>
        <li>Example cases and your settings never leave this device.</li>
      </ul>
    </section>
    <section class="card section">
      <h2>Files made and added here</h2>
      ${activityList(sharedFiles(), false)}
    </section>
  </div>`;
}

function exportSheet(preselect) {
  const cases = liveCases().filter((c) => !c.example).sort((a, b) => collator.compare(b.updated, a.updated));
  if (!cases.length) {
    toast(hasExamples() ? 'Example cases are never shared. Open a real case first.' : 'There are no cases to share yet.');
    return;
  }
  const scope = preselect ? 'choose' : 'open';
  openSheet({
    title: 'Create a Casebook file',
    wide: true,
    body: html`<fieldset class="field">
        <legend>Which cases</legend>
        ${radioPills('scope', { open: `Open cases (${fmtNum(cases.filter(isOpen).length)})`, all: `All cases (${fmtNum(cases.length)})`, choose: 'Let me choose' }, scope)}
      </fieldset>
      <fieldset class="field" id="x-choose"${raw(scope === 'choose' ? '' : ' hidden')}>
        <legend class="visually-hidden">Cases</legend>
        <ul class="pick-list">${cases.map((c) => html`<li><label class="check"><input type="checkbox" name="case" value="${c.id}" data-input="export-option"${checked(c.id === preselect)}><span><strong>${c.ref}</strong> ${c.title}<span class="muted small"> · ${STAGES[c.stage].label}</span></span></label></li>`)}</ul>
      </fieldset>
      <fieldset class="field">
        <legend>What to include</legend>
        <label class="check"><input type="checkbox" name="files" data-input="export-option" checked><span>Evidence files <span class="muted small" id="x-size"></span></span></label>
        <label class="check"><input type="checkbox" name="confidential" data-input="export-option"><span>Confidential people <span class="muted small">(reporters, witnesses and others marked confidential)</span></span></label>
        <p class="hint">Names written inside summaries, diary entries or tasks aren't removed. Example cases are never included.</p>
      </fieldset>
      <div class="field">
        <label for="x-pass">Passphrase for this file</label>
        <div class="pass-row"><input id="x-pass" name="passphrase" type="text" value="${suggestPassphrase()}" spellcheck="false" autocapitalize="off" autocomplete="off" class="mono"><button class="btn btn-outline" type="button" data-action="suggest-pass" data-targets="x-pass">${icon('refresh')} New</button></div>
        <p class="hint">The person you send it to needs this to open it. Tell them in person or by phone. Don't send it in the same message as the file.</p>
      </div>
      <div class="field"><label for="x-note">Note for them <span class="optional">(optional, sealed inside the file)</span></label><input id="x-note" name="note" type="text" maxlength="200" placeholder="For example: For Adv. Sharma, hearing on 5 Nov"></div>`,
    submitLabel: 'Create the file',
    onMount: (form) => updateExportSize(form),
    async onSubmit(form) {
      const f = form.elements;
      const pick = f.scope.value;
      const chosen = new Set(Array.from(form.querySelectorAll('input[name="case"]:checked'), (el) => el.value));
      const caseIds = pick === 'all' ? new Set(cases.map((c) => c.id)) : pick === 'open' ? new Set(cases.filter(isOpen).map((c) => c.id)) : chosen;
      if (!caseIds.size) {
        sheetError('Choose at least one case.');
        return false;
      }
      const pass = f.passphrase.value;
      const strength = passphraseStrength(pass, CONFIG.minPassphrase);
      if (strength.block) {
        sheetError(`Use a passphrase of at least ${CONFIG.minPassphrase} characters that's hard to guess.`);
        return false;
      }
      const result = await createCasefile({ caseIds, files: f.files.checked, confidential: f.confidential.checked, passphrase: pass, note: f.note.value.trim(), purpose: 'share' });
      fileReadySheet(result, pass);
      return false;
    },
  });
}

function updateExportSize(form) {
  const f = form.elements;
  const cases = liveCases().filter((c) => !c.example);
  const pick = f.scope.value;
  document.getElementById('x-choose').hidden = pick !== 'choose';
  const chosen = new Set(Array.from(form.querySelectorAll('input[name="case"]:checked'), (el) => el.value));
  const caseIds = pick === 'all' ? new Set(cases.map((c) => c.id)) : pick === 'open' ? new Set(cases.filter(isOpen).map((c) => c.id)) : chosen;
  const sel = selectForExport(Array.from(session.records.values()), { caseIds, files: true });
  const size = sel.files.reduce((sum, file) => sum + file.size, 0);
  document.getElementById('x-size').textContent = sel.files.length ? `(${plural(sel.files.length, 'file')}, ${fmtBytes(size)})` : '(none in these cases)';
}

function backupSheet() {
  openSheet({
    title: 'Back up everything',
    body: html`<p>The backup holds every case, file and log entry, encrypted with the passphrase you choose here. You can use your Casebook passphrase.</p>
      ${passField({ id: 'b-pass', name: 'passphrase', label: 'Passphrase for the backup', autocomplete: 'new-password' })}
      ${passField({ id: 'b-repeat', name: 'repeat', label: 'Type it again', autocomplete: 'new-password' })}
      <label class="check"><input type="checkbox" name="files" checked><span>Include evidence files <span class="muted small">(recommended)</span></span></label>
      <p class="hint">Without this passphrase the backup can't be opened, by anyone. Store the file away from this device.</p>`,
    submitLabel: 'Create the backup',
    async onSubmit(form) {
      const f = form.elements;
      if (passphraseStrength(f.passphrase.value, CONFIG.minPassphrase).block) {
        sheetError(`Use a passphrase of at least ${CONFIG.minPassphrase} characters that's hard to guess.`);
        return false;
      }
      if (f.passphrase.value !== f.repeat.value) {
        sheetError("The two passphrases don't match.");
        return false;
      }
      const result = await createCasefile({ caseIds: null, files: f.files.checked, confidential: true, passphrase: f.passphrase.value, note: '', purpose: 'backup' });
      fileReadySheet(result, '');
      return false;
    },
  });
}

async function createCasefile({ caseIds, files, confidential, passphrase, note, purpose }) {
  const sel = selectForExport(Array.from(session.records.values()), { caseIds, files, confidential });
  const present = [];
  let missing = 0;
  for (const file of sel.files) {
    if (await hasFile(session.keys, chunkStore, file)) present.push(file);
    else missing++;
  }
  const s = session.settings;
  const manifest = {
    app: 'mwf-casebook',
    version: 1,
    purpose,
    created: now(),
    from: { name: s.name, deviceName: s.deviceName, device: s.deviceId },
    note,
    cases: sel.cases,
    confidential,
    records: sel.records,
    files: present,
  };
  const blob = await withBusy('Creating the file…', (progress) => writeCasefile({
    passphrase,
    manifest,
    readChunk: (file, i) => readFileChunk(session.keys, chunkStore, file, i),
    onProgress: (done, total) => progress(done, total, `Encrypting ${fmtBytes(done)} of ${fmtBytes(total)}`),
  }));
  const shareCases = caseIds ? liveCases().filter((c) => caseIds.has(c.id) && !c.example) : [];
  const what = purpose === 'backup' ? 'backup' : shareCases.length === 1 ? shareCases[0].ref : `${shareCases.length}-cases`;
  const name = `megafauna-casebook-${today()}-${what}${FILE_EXTENSION}`;
  const summary = `${plural(sel.cases, 'case')}, ${plural(present.length, 'evidence file')}${confidential ? '' : ', confidential people left out'}`;
  const logs = [{ action: 'file.export', text: `Created ${purpose === 'backup' ? 'a backup' : 'a Casebook file'}: ${summary}${note ? `. Note: ${note}` : ''}` }];
  if (purpose === 'share') {
    for (const c of shareCases) logs.push({ action: 'case.share', caseId: c.id, target: c.id, text: `Shared in a Casebook file${present.length && files ? ' with its evidence files' : ''}${confidential ? '' : ', without confidential people'}${note ? `. Note: ${note}` : ''}` });
  }
  await writeRecords([], logs, purpose === 'backup' ? { lastBackup: now() } : null);
  return { blob, name, summary, missing };
}

function fileReadySheet({ blob, name, summary, missing }, passphrase) {
  const file = new File([blob], name, { type: 'application/octet-stream' });
  const canShare = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  openSheet({
    title: 'Your Casebook file is ready',
    body: html`<div class="file-ready">
        <span class="card-icon">${icon('lock')}</span>
        <div><p class="file-name">${name}</p><p class="muted small">${fmtBytes(blob.size)} · ${summary}</p></div>
      </div>
      ${missing ? notice('warn', 'warn', html`<p>${plural(missing, 'evidence file')} ${missing === 1 ? "isn't" : "aren't"} on this device, so ${missing === 1 ? 'it was' : 'they were'} left out. Their details and fingerprints are included.</p>`) : ''}
      ${passphrase ? html`<div class="hash-box">
        <p class="eyebrow">Passphrase to tell them</p>
        <p class="passphrase-big">${passphrase}</p>
        <p class="hint">Say it in person or on a call. Don't send it with the file.</p>
      </div>` : html`<p class="muted">Keep the backup somewhere away from this device, and keep its passphrase safe.</p>`}
      <div class="btn-row">
        <button class="btn btn-primary" type="button" data-action="download-file">${icon('download')} Download</button>
        ${canShare ? html`<button class="btn btn-outline" type="button" data-action="share-file">${icon('share')} Send…</button>` : ''}
      </div>`,
    onMount() {
      readyFile = file;
      onSheetClose(() => {
        readyFile = null;
      });
    },
  });
}

let readyFile = null;

async function importChosen(input) {
  pickingFile = false;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  try {
    await readCasefileHeader(file);
  } catch (err) {
    toast(messageFor(err));
    return;
  }
  openSheet({
    title: 'Open a Casebook file',
    body: html`<div class="file-ready"><span class="card-icon">${icon('lock')}</span><div><p class="file-name">${file.name}</p><p class="muted small">${fmtBytes(file.size)}</p></div></div>
      ${passField({ id: 'i-pass', name: 'passphrase', label: "The file's passphrase", autocomplete: 'off', hint: 'The person who made the file will have told you. For your own backup, it’s the one you chose when you made it.' })}`,
    submitLabel: 'Open',
    onMount: (form) => setTimeout(() => form.elements.passphrase.focus(), 50),
    async onSubmit(form) {
      let opened;
      try {
        opened = await withBusy('Opening the file…', () => openCasefile(file, form.elements.passphrase.value));
      } catch (err) {
        sheetError(err.code === 'wrong-passphrase' ? "That passphrase doesn't open this file. Check it with the person who sent it." : messageFor(err));
        return false;
      }
      const preview = previewImport(opened);
      if (!preview) {
        sheetError(messageFor(new CasebookError('damaged')));
        return false;
      }
      importPreviewSheet(file, opened, preview);
      return false;
    },
  });
}

function previewImport(opened) {
  const m = opened.manifest;
  if (m.app !== 'mwf-casebook' || !Array.isArray(m.records)) return null;
  const records = m.records.map(clean).filter(Boolean);
  const files = cleanFileList(m.files, records);
  if (!files) return null;
  const plan = planMerge(session.records, records);
  const caseStatus = new Map();
  const changedIds = new Set(plan.put.map((r) => r.id));
  for (const r of records) {
    if (r.kind !== 'case') continue;
    const cur = session.records.get(r.id);
    let status = 'same';
    if (!cur) status = r.deleted ? 'deleted' : 'new';
    else if (changedIds.has(r.id)) status = r.deleted ? 'deleted' : 'updated';
    else if (cur.deleted && !r.deleted) status = 'gone';
    caseStatus.set(r.id, { record: r, status });
  }
  for (const r of plan.put) {
    if (r.kind === 'case' || r.kind === 'log' || !r.caseId) continue;
    const entry = caseStatus.get(r.caseId);
    if (entry && entry.status === 'same') entry.status = 'updated';
  }
  // Cases deleted here that the file still has: a deletion wins over older
  // copies, so these only come back if someone chooses to restore them.
  const restorable = Array.from(caseStatus.values()).filter((s) => s.status === 'gone').map((s) => s.record.id);
  return { records, files, plan, caseStatus, restorable };
}

const CASE_STATUS = {
  new: { label: 'New to you', tone: 'good' },
  updated: { label: 'Has changes', tone: 'info' },
  same: { label: 'Nothing new', tone: '' },
  deleted: { label: 'Deleted by them', tone: 'warn' },
  gone: { label: 'Deleted here', tone: 'warn' },
};

function importPreviewSheet(file, opened, preview) {
  const m = opened.manifest;
  const from = m.from && typeof m.from === 'object' ? m.from : {};
  const statuses = Array.from(preview.caseStatus.values());
  const count = (s) => statuses.filter((x) => x.status === s).length;
  const fileBytes = preview.files.filter((f) => f.wanted).reduce((sum, f) => sum + f.size, 0);
  const restorable = new Set(preview.restorable);
  const kept = preview.plan.kept.filter((r) => !restorable.has(r.id) && !restorable.has(r.caseId)).length;
  openSheet({
    title: 'Add these cases?',
    wide: true,
    body: html`<dl class="facts">
        ${fact('From', [typeof from.name === 'string' ? from.name : '', typeof from.deviceName === 'string' && from.deviceName ? `on ${from.deviceName}` : ''].filter(Boolean).join(' ') || 'Not given')}
        ${fact('Made', typeof m.created === 'string' ? fmtMoment(m.created) : '')}
        ${fact('Kind', m.purpose === 'backup' ? 'A full backup' : 'Shared cases')}
        ${fact('Note', typeof m.note === 'string' ? m.note.slice(0, 200) : '')}
        ${fact('Evidence files', preview.files.length ? `${plural(preview.files.length, 'file')}, ${fmtBytes(fileBytes)}` : 'None included')}
        ${fact('Confidential people', m.confidential === false ? 'Left out by the sender' : 'Included')}
      </dl>
      <p><strong>${listText([count('new') ? `${plural(count('new'), 'new case')}` : '', count('updated') ? `${plural(count('updated'), 'case')} with changes` : '', count('same') ? `${plural(count('same'), 'case')} with nothing new` : '', count('deleted') ? `${plural(count('deleted'), 'case')} deleted by the sender` : '', count('gone') ? `${plural(count('gone'), 'case')} you deleted here` : ''].filter(Boolean)) || 'No cases'}.</strong></p>
      ${statuses.length ? html`<ul class="pick-list">${statuses.map((s) => html`<li class="import-case"><span><strong>${s.record.ref || ''}</strong> ${s.record.title || ''}</span>${chip(CASE_STATUS[s.status].tone, '', CASE_STATUS[s.status].label)}</li>`)}</ul>` : ''}
      ${kept ? html`<p class="muted small">${plural(kept, 'record')} in the file ${kept === 1 ? 'is' : 'are'} older than yours, so yours ${kept === 1 ? 'is' : 'are'} kept.</p>` : ''}
      ${preview.restorable.length ? html`<label class="check"><input type="checkbox" name="restore"><span><strong>Bring back ${plural(preview.restorable.length, 'case')} deleted on this device.</strong> The copy in this file replaces the deletion, here and on other devices when you next share.</span></label>` : ''}
      <p class="muted small">Nothing on this device is deleted except records the sender deliberately deleted.</p>`,
    submitLabel: 'Add to my Casebook',
    async onSubmit(form) {
      const restore = Boolean(form.elements.restore && form.elements.restore.checked);
      const result = await commitImport(file, opened, preview, restore);
      importResultSheet(result);
      return false;
    },
  });
}

async function commitImport(file, opened, preview, restore) {
  const failed = [];
  const stored = new Set();
  let already = 0;
  await withBusy('Checking and adding files…', async (progress) => {
    const jobs = new Map();
    for (const f of preview.files) {
      if (!f.wanted) continue;
      if (await hasFile(session.keys, chunkStore, f)) {
        already++;
        continue;
      }
      jobs.set(f.sha256, { file: f, name: await fileName(session.keys, f.sha256), hash: new Sha256(), size: 0, total: chunkCount(f.size), ok: true });
    }
    const totalBytes = Array.from(jobs.values()).reduce((sum, j) => sum + j.file.size, 0);
    let doneBytes = 0;
    await readCasefileFiles(file, opened, async (f, i, read) => {
      const job = jobs.get(f.sha256);
      if (!job) return;
      if (job.ok) {
        try {
          const bytes = await read();
          job.hash.update(bytes);
          job.size += bytes.length;
          doneBytes += bytes.length;
          await storeFileChunk(session.keys, chunkStore, job.file, i, bytes, job.name);
          progress(doneBytes, totalBytes, `Checking and adding files: ${fmtBytes(doneBytes)} of ${fmtBytes(totalBytes)}`);
        } catch (err) {
          if (err.code === 'damaged') throw err;
          job.ok = false;
        }
      }
      if (i === job.total - 1) {
        if (job.ok && toHex(job.hash.digest()) === job.file.sha256 && job.size === job.file.size) {
          stored.add(job.file.sha256);
        } else {
          failed.push(job.file.sha256);
          await chunkStore.deleteChunks(job.name);
        }
      }
    });
  }).catch(async (err) => {
    await tidyStorage().catch(() => undefined);
    throw err;
  });

  // Restored cases are stamped as changed now, so they win over the deletion.
  const revived = new Set(restore ? preview.restorable : []);
  const stamp = now();
  const incoming = preview.records.map((r) => {
    if (r.kind === 'log' || r.deleted || !(revived.has(r.id) || revived.has(r.caseId))) return r;
    const cur = session.records.get(r.id);
    return clean(Object.assign({}, r, { updated: stamp, updatedBy: session.settings.name, rev: Math.max(r.rev || 1, cur ? cur.rev || 1 : 1) + 1 }));
  });
  const plan = planMerge(session.records, incoming);
  const m = opened.manifest;
  const from = m.from && typeof m.from.name === 'string' && m.from.name ? `${m.from.name}${typeof m.from.deviceName === 'string' && m.from.deviceName ? ` (${m.from.deviceName})` : ''}` : 'someone';
  const touched = new Set();
  for (const r of plan.put) if (r.kind !== 'log') touched.add(r.kind === 'case' ? r.id : r.caseId);
  // Files whose evidence the sender deleted can go, if nothing else uses them.
  const dropped = plan.put.filter((r) => r.kind === 'evidence' && r.deleted).map((r) => (session.records.get(r.id) || {}).sha256);
  const logs = [];
  for (const r of preview.records) {
    if (r.kind === 'evidence' && !r.deleted && stored.has(r.sha256)) {
      logs.push({ action: 'evidence.receive', caseId: r.caseId, target: r.id, text: `Received “${r.fileName}” from ${from}: fingerprint checked, it matches` });
    }
  }
  for (const caseId of touched) {
    if (!isId(caseId)) continue;
    if (revived.has(caseId)) logs.push({ action: 'case.restore', caseId, target: caseId, text: `Brought the case back from a ${m.purpose === 'backup' ? 'backup' : 'Casebook file'} from ${from}, after it had been deleted here` });
    else logs.push({ action: 'case.receive', caseId, target: caseId, text: `Received changes from ${from} in a Casebook file` });
  }
  const stats = plan.stats.case || { added: 0, updated: 0, removed: 0, kept: 0, same: 0 };
  logs.unshift({ action: 'file.import', text: `Added a ${m.purpose === 'backup' ? 'backup' : 'Casebook file'} from ${from}: ${stats.added} new and ${stats.updated} updated cases, ${plural(stored.size, 'file')} checked and stored${failed.length ? `, ${failed.length} failed the fingerprint check` : ''}` });
  await writeRecords(plan.put, logs);
  if (dropped.length) await dropUnusedFiles(dropped).catch(() => undefined);
  return { stats: plan.stats, stored: stored.size, already, failed, records: plan.put.length };
}

function importResultSheet(result) {
  const s = result.stats;
  const c = s.case || { added: 0, updated: 0, removed: 0, kept: 0, same: 0 };
  const other = ['animal', 'person', 'evidence', 'entry', 'task'].reduce((sum, kind) => sum + (s[kind] ? s[kind].added + s[kind].updated + s[kind].removed : 0), 0);
  openSheet({
    title: result.failed.length ? 'Added, with problems' : 'Cases added',
    body: html`${result.failed.length ? notice('warn', 'warn', html`<p><strong>${plural(result.failed.length, 'evidence file')} failed the fingerprint check</strong> and ${result.failed.length === 1 ? 'was' : 'were'} not stored. The file may have been damaged on the way. Ask for it again.</p>`) : ''}
      <ul class="bullets">
        <li>${plural(c.added, 'new case')}, ${plural(c.updated, 'case')} updated${c.removed ? `, ${plural(c.removed, 'case')} deleted by the sender` : ''}.</li>
        <li>${plural(other, 'other change')} to animals, people, evidence, diaries and tasks.</li>
        <li>${plural(result.stored, 'evidence file')} checked against ${result.stored === 1 ? 'its' : 'their'} fingerprint and stored${result.already ? `; ${fmtNum(result.already)} ${result.already === 1 ? 'was' : 'were'} already here` : ''}.</li>
        ${s.log && s.log.added ? html`<li>${plural(s.log.added, 'activity log entry', 'activity log entries')} added to the history.</li>` : ''}
        ${c.kept ? html`<li>${plural(c.kept, 'case')} kept as yours, because your copy was newer.</li>` : ''}
      </ul>`,
    doneLabel: 'Done',
  });
  render();
}

/* Settings ---------------------------------------------------------------- */

let installPrompt = null;

function viewSettings() {
  const s = session.settings;
  const logs = idx().logs;
  const devices = new Set(logs.map((e) => e.device)).size;
  const theme = readTheme();
  return html`<div class="view">
    <header class="view-head"><div>
      <h1 tabindex="-1">Settings</h1>
      <p class="lead">You, this device, security and storage.</p>
    </div>
    <button class="btn btn-primary" type="button" data-action="lock">${icon('lock')} Lock now</button></header>

    <section class="card section" aria-labelledby="you-title">
      <h2 id="you-title">You and this device</h2>
      <div class="field-row">
        <div class="field"><label for="st-name">Your name</label><input id="st-name" type="text" maxlength="80" value="${s.name}" data-input="setting" data-key="name" spellcheck="false"></div>
        <div class="field"><label for="st-device">This device</label><input id="st-device" type="text" maxlength="80" value="${s.deviceName}" data-input="setting" data-key="deviceName" placeholder="For example: Field phone" spellcheck="false"></div>
      </div>
      <p class="hint">Both are written into the activity log with everything you do, so the team can tell who did what, on which device.</p>
    </section>

    <section class="card section" aria-labelledby="lock-title">
      <h2 id="lock-title">Locking</h2>
      <div class="field">
        <label for="st-auto">Lock after this long without use</label>
        <select id="st-auto" data-input="auto-lock">${options(AUTO_LOCK, String(s.autoLock))}</select>
      </div>
      <label class="check"><input type="checkbox" data-input="lock-on-hide"${checked(s.lockOnHide)}><span><strong>Lock as soon as I switch away</strong> to another app or tab. Safest on a shared or field phone. (Taking photos for a case doesn't count.)</span></label>
      <div class="btn-row"><button class="btn btn-outline" type="button" data-action="change-pass">${icon('key')} Change passphrase</button></div>
    </section>

    <section class="card section" aria-labelledby="log-title">
      <h2 id="log-title">Activity log</h2>
      <p class="muted">${plural(logs.length, 'entry', 'entries')} from ${plural(devices, 'device')}. Each device links its entries in a chain of SHA-256 hashes, so a changed or removed entry shows up when the log is checked.</p>
      <div class="btn-row"><button class="btn btn-outline" type="button" data-action="verify-log">${icon('fingerprint')} Check the log</button></div>
      <details class="table-toggle">
        <summary>${icon('list')} Show the latest entries</summary>
        ${activityList(logs.slice(0, 40), true)}
      </details>
    </section>

    <section class="card section" aria-labelledby="storage-title">
      <h2 id="storage-title">Storage</h2>
      <p id="storage-estimate" class="muted">Working out how much space is used…</p>
      <p id="storage-persist" class="muted small"></p>
    </section>

    <section class="card section" aria-labelledby="theme-title">
      <h2 id="theme-title">Appearance</h2>
      <fieldset class="field"><legend class="visually-hidden">Theme</legend>${radioPills('theme', { system: 'Match this device', light: 'Light', dark: 'Dark' }, theme)}</fieldset>
    </section>

    ${installPrompt ? html`<section class="card section"><h2>Install</h2><p class="muted">Install the Casebook to open it like an app. It also works offline once installed.</p><div class="btn-row"><button class="btn btn-outline" type="button" data-action="install">${icon('download')} Install the Casebook</button></div></section>` : ''}

    <section class="card section" aria-labelledby="ex-title">
      <h2 id="ex-title">Example cases</h2>
      ${hasExamples()
        ? html`<p class="muted">Example cases are showing. Removing them leaves your own cases alone.</p><div class="btn-row"><button class="btn btn-outline" type="button" data-action="remove-examples">Remove the examples</button></div>`
        : html`<p class="muted">Add a few made-up cases to see how the Casebook works. You can remove them in one go, and they're never shared.</p><div class="btn-row"><button class="btn btn-outline" type="button" data-action="load-examples">${icon('sparkle')} Show example cases</button></div>`}
    </section>

    <section class="card section" aria-labelledby="guide-title">
      <h2 id="guide-title">Investigation guide</h2>
      <p class="muted">Gathering evidence that holds up, going to the police, and electronic evidence in court.</p>
      <div class="btn-row"><a class="btn btn-outline" href="#guide">${icon('book')} Open the guide</a></div>
    </section>

    <section class="card section" aria-labelledby="protect-title">
      <h2 id="protect-title">How the cases are protected</h2>
      <ul class="bullets small">
        <li>Your passphrase is stretched with PBKDF2-SHA-256 (600,000 rounds) into a key that unlocks a random 256-bit master key. The passphrase itself is never stored.</li>
        <li>Every record and every piece of every file is encrypted with AES-256-GCM before it is saved in this browser. Changing or swapping anything makes decryption fail.</li>
        <li>The app has no server. Its security policy blocks it from connecting anywhere, and it loads nothing from other websites, not even fonts.</li>
        <li>Casebook files are encrypted the same way with their own passphrase, and every evidence file is fingerprint-checked when it arrives.</li>
        <li>Locking clears the cases from the page's memory. Anyone with your unlocked device, or with your passphrase and a copy of this browser's data, can read the cases, so lock it when you put it down.</li>
      </ul>
    </section>

    <section class="card section danger-zone" aria-labelledby="erase-title">
      <h2 id="erase-title">Erase the Casebook</h2>
      <p class="muted">Deletes every case, file and log entry from this device. Back up first if you might need them.</p>
      <div class="btn-row"><button class="btn btn-danger" type="button" data-action="erase">${icon('trash')} Erase from this device</button></div>
    </section>

    <p class="about-app muted small">MegaFauna Casebook, from ${CONFIG.orgName}. <a href="${CONFIG.websiteUrl}">Visit our website</a>.</p>
  </div>`;
}

async function mountSettings() {
  const estimate = document.getElementById('storage-estimate');
  const persist = document.getElementById('storage-persist');
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (estimate) estimate.textContent = `This site is using ${fmtBytes(usage || 0)} of about ${fmtBytes(quota || 0)} the browser allows.`;
    } catch (err) {
      if (estimate) estimate.textContent = "This browser doesn't say how much space is used.";
    }
  } else if (estimate) estimate.textContent = "This browser doesn't say how much space is used.";
  if (!persist) return;
  if (navigator.storage && navigator.storage.persisted) {
    const kept = await navigator.storage.persisted().catch(() => false);
    if (kept) persist.textContent = 'This browser has agreed to keep the Casebook even when space runs low.';
    else {
      persist.replaceChildren(document.createTextNode('The browser may clear the Casebook if the device runs very low on space. '));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-link';
      btn.dataset.action = 'persist';
      btn.textContent = 'Ask it to keep the data';
      persist.append(btn);
    }
  }
}

function onSettingInput(input) {
  const key = input.dataset.key;
  if (key !== 'name' && key !== 'deviceName') return;
  pendingSettings[key] = input.value.trim().slice(0, 80);
  saveSettingsSoon();
}

const pendingSettings = {};
let settingsTimer = 0;
function saveSettingsSoon() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    if (!session) return;
    const changes = Object.assign({}, pendingSettings);
    for (const key of Object.keys(pendingSettings)) delete pendingSettings[key];
    saveSettings(changes).catch((err) => toast(messageFor(err)));
  }, 500);
}

function changePassSheet() {
  openSheet({
    title: 'Change your passphrase',
    body: html`${passField({ id: 'cp-old', name: 'current', label: 'Current passphrase', autocomplete: 'current-password' })}
      ${passField({ id: 'cp-new', name: 'passphrase', label: 'New passphrase', autocomplete: 'new-password', input: 'new-pass', hint: `At least ${CONFIG.minPassphrase} characters.` })}
      ${strengthMeter('strength')}
      ${passField({ id: 'cp-repeat', name: 'repeat', label: 'Type the new one again', autocomplete: 'new-password' })}
      <p class="hint">Backups and Casebook files you've already made keep the passphrase they were made with.</p>`,
    submitLabel: 'Change passphrase',
    async onSubmit(form) {
      const f = form.elements;
      if (passphraseStrength(f.passphrase.value, CONFIG.minPassphrase).block) {
        sheetError(`Use a passphrase of at least ${CONFIG.minPassphrase} characters that's hard to guess.`);
        return false;
      }
      if (f.passphrase.value !== f.repeat.value) {
        sheetError("The two new passphrases don't match.");
        return false;
      }
      try {
        await withBusy('Changing the passphrase…', async () => {
          const meta = await changePassphrase(await store.getMeta(), f.current.value, f.passphrase.value);
          await store.putMeta(meta);
          session.meta = meta;
        });
      } catch (err) {
        sheetError(err.code === 'wrong-passphrase' ? "The current passphrase isn't right." : messageFor(err));
        return false;
      }
      await logOnly({ action: 'casebook.passphrase', text: 'Changed the passphrase' });
      toast('Passphrase changed');
      return undefined;
    },
  });
}

async function verifyLogSheet() {
  const logs = idx().logs;
  const s = session.settings;
  const result = await withBusy('Checking the activity log…', () => verifyLog(logs, { device: s.deviceId, seq: s.logSeq, head: s.logHead }));
  const problemText = (d) => listText([
    d.changed ? `${plural(d.changed, 'entry', 'entries')} changed` : '',
    d.broken ? `${plural(d.broken, 'broken link')} in the chain` : '',
    d.missing ? `${plural(d.missing, 'entry', 'entries')} missing` : '',
    d.forked ? `${plural(d.forked, 'duplicate')}` : '',
  ].filter(Boolean));
  openSheet({
    title: result.ok ? 'The activity log checks out' : 'The activity log has problems',
    body: html`${result.ok
      ? notice('', 'check', html`<p><strong>All ${plural(result.entries, 'entry', 'entries')} check out.</strong> None has been changed, and none is missing from this device's chain.</p>`)
      : notice('warn', 'warn', html`<p><strong>Some entries don't check out.</strong> Someone may have changed this browser's stored data, or a device's records were damaged.</p>`)}
      <ul class="device-list">${result.devices.map((d) => html`<li>
        <span>${d.ok ? icon('check', 'tone-good') : icon('warn', 'tone-bad')}</span>
        <span><strong>${d.deviceName || 'Unnamed device'}</strong>${d.own ? ' (this device)' : ''}<br><span class="muted small">${plural(d.entries, 'entry', 'entries')}${d.ok ? '' : ` · ${problemText(d)}`}${!d.own ? ' · shared files only carry entries about their cases, so gaps are expected' : ''}</span></span>
      </li>`)}</ul>
      <p class="muted small">The newest entry from this device is fingerprinted ${shortHash(s.logHead)}. Note it down somewhere else from time to time: if the log were ever rewritten, it would no longer match.</p>`,
  });
}

function readTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch (err) {
    return 'system';
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const bars = { light: '#FBF7F0', dark: '#0E1612' };
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const own = (meta.getAttribute('media') || '').includes('dark') ? bars.dark : bars.light;
    meta.setAttribute('content', theme === 'light' || theme === 'dark' ? bars[theme] : own);
  });
}

function setTheme(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    // The choice just won't be remembered.
  }
  applyTheme(theme);
}

/* Example cases ------------------------------------------------------------- */

async function loadExamples() {
  const { records, files } = buildExamples({ today: today(), addDays, name: session.settings.name });
  await withBusy('Adding example cases…', async () => {
    for (const item of files) {
      const file = await item.make();
      const sha256 = await fingerprintBlob(file);
      if (!(await hasFile(session.keys, chunkStore, { sha256, size: file.size }))) await saveFile(session.keys, chunkStore, file, sha256);
      const ev = records.find((r) => r.id === item.evidenceId);
      Object.assign(ev, { sha256, size: file.size, mime: file.type, fileName: file.name, thumb: await makeThumb(file) });
    }
    await writeRecords(records.map(clean).filter(Boolean), [{ action: 'casebook.examples', text: `Added ${plural(records.filter((r) => r.kind === 'case').length, 'example case')}` }]);
  });
  toast('Example cases added');
  render();
}

async function removeExamples() {
  const examples = Array.from(session.records.values()).filter((r) => r.example && !r.deleted && r.kind !== 'log');
  const shas = examples.filter((r) => r.kind === 'evidence').map((r) => r.sha256);
  await withBusy('Removing the examples…', async () => {
    // Examples never travel, so they're removed outright, without tombstones.
    await store.deleteRecords(examples.map((r) => r.id));
    for (const r of examples) session.records.delete(r.id);
    index = null;
    await dropUnusedFiles(shas);
    await logOnly({ action: 'casebook.examples', text: 'Removed the example cases' });
  });
  const route = parseRoute(routeHash);
  if ((route.name === 'case' || route.name === 'edit-case' || route.name === 'report') && !getCase(route.id)) navigate('#overview', true);
  else render();
  toast('Examples removed');
}

/* Investigation guide ------------------------------------------------------- */

function viewGuide() {
  return html`<div class="view guide">
    <a class="back" href="#settings">${icon('chevron-left')} Settings</a>
    <header class="view-head"><div>
      <h1 tabindex="-1">Investigation guide</h1>
      <p class="lead">How to gather evidence that holds up, and what to do with it. General information for the foundation's volunteers, not legal advice.</p>
    </div></header>

    <section class="card section">
      <h2>At the scene</h2>
      <ol class="steps-small">
        <li><strong>Your safety comes first.</strong> Don't confront anyone. If a person or animal is in danger right now, call 112.</li>
        <li><strong>Photograph and film before anything is moved:</strong> the animal and its injuries (close up and from further away), the place, any food, packets, weapons or vehicles, and number plates. Keep the camera's date and location settings on.</li>
        <li><strong>Never edit, crop or filter the originals.</strong> Add them to the Casebook as they are. Their fingerprints show later that they haven't been changed. Keep the originals on the phone until the case is over.</li>
        <li><strong>Note witnesses</strong>: names, numbers and what they saw, in their words. Mark reporters and witnesses confidential.</li>
        <li><strong>Ask about CCTV straight away</strong>, in writing, at shops, houses and offices nearby. Footage is often recorded over within days.</li>
        <li><strong>Get the animal to a vet</strong> and ask for a written injury report, or a post-mortem if it has died. It's often the strongest evidence.</li>
      </ol>
    </section>

    <section class="card section">
      <h2>Going to the police</h2>
      <ol class="steps-small">
        <li>Give a written complaint at the police station. Any station has to take it, even if the place is in another station's area ("zero FIR", BNSS s.173). Keep a copy stamped as received.</li>
        <li>Killing, poisoning or maiming an animal is a cognisable offence under section 325 of the Bharatiya Nyaya Sanhita, 2023, so the police should register an FIR. Cruelty is also an offence under section 11 of the Prevention of Cruelty to Animals Act, 1960. You're entitled to a free copy of the FIR.</li>
        <li>If the station won't register it, send the complaint in writing to the Superintendent of Police (BNSS s.173(4)). If that fails too, a Magistrate can be asked to order an investigation (BNSS s.175(3)), with a copy of what was sent to the SP and an affidavit. Our Legal Aid team can help with both.</li>
        <li>Write the FIR number, sections and the investigating officer's details in the case's <strong>Legal</strong> tab, and add the FIR copy as evidence.</li>
      </ol>
    </section>

    <section class="card section">
      <h2>Electronic evidence in court</h2>
      <p>Photos, videos, recordings and messages are electronic records. To use them in court, a certificate under section 63(4) of the Bharatiya Sakshya Adhiniyam, 2023 is filed with them. Its form asks for the hash value of each record, worked out with an algorithm such as SHA-256.</p>
      <p>The Casebook works out the SHA-256 hash ("fingerprint") of every file as it's added, re-checks it whenever you ask and whenever the file moves between devices, and lists every fingerprint in the case report. Give the report to the lawyer preparing the certificate. Part A is completed by the person who made the recording or is in charge of the device; Part B by an expert.</p>
      <p class="muted small">Keep the original device if you can, and note in the evidence's history who has had it.</p>
    </section>

    <section class="card section">
      <h2>Community dogs and feeders</h2>
      <p>Under the Animal Birth Control Rules, 2023, community dogs are to be sterilised, vaccinated and returned to the same area. Removing or relocating them is against the rules. If feeders are threatened or harassed, record what was said, when and by whom, and open a case.</p>
    </section>

    <section class="card section">
      <h2>Keeping people safe</h2>
      <ul class="bullets">
        <li>Reporters and witnesses can come under pressure. Mark them confidential, and leave confidential people out when a case goes outside the team.</li>
        <li>Share Casebook files only with people working on the case. Tell them the passphrase in person or by phone, never in the same message as the file.</li>
        <li>Lock the Casebook whenever you put the device down, and turn on "lock as soon as I switch away" on phones used in the field.</li>
      </ul>
    </section>

    <p class="muted small">Laws, rules and court decisions change, and they can apply differently from case to case. Talk to the foundation's Legal Aid team about any specific case.</p>
  </div>`;
}

/* Case report ----------------------------------------------------------------- */

const reportOptions = { confidential: false, diary: true, activity: true };

function viewReport(route) {
  const c = getCase(route.id);
  if (!c) return notFound();
  const k = kids(c.id);
  const people = k.person.filter((p) => reportOptions.confidential || !p.confidential);
  const hidden = k.person.length - people.length;
  const L = c.legal;
  const s = session.settings;
  const legalRows = Object.keys(LEGAL_FIELDS).filter((key) => L[key]).map((key) => [LEGAL_FIELDS[key].label, LEGAL_FIELDS[key].date ? fmtDate(L[key]) : L[key]]);
  return html`<div class="view report-view">
    <div class="report-tools no-print">
      <a class="back" href="#case/${c.id}">${icon('chevron-left')} Back to the case</a>
      <div class="report-options">
        <label class="check"><input type="checkbox" data-input="report-option" data-key="confidential"${checked(reportOptions.confidential)}><span>Include confidential people</span></label>
        <label class="check"><input type="checkbox" data-input="report-option" data-key="diary"${checked(reportOptions.diary)}><span>Diary</span></label>
        <label class="check"><input type="checkbox" data-input="report-option" data-key="activity"${checked(reportOptions.activity)}><span>Activity log</span></label>
      </div>
      <button class="btn btn-primary" type="button" data-action="print-report" data-id="${c.id}">${icon('printer')} Print or save as PDF</button>
      <p class="muted small">The printed or saved report isn't encrypted. Keep it as safely as the case.</p>
    </div>

    <article class="report">
      <header class="report-head">
        <p class="eyebrow">${CONFIG.orgName} · Case report · Confidential</p>
        <h1 tabindex="-1">${c.title || 'Untitled case'}</h1>
        <p class="report-ref">${c.ref}</p>
        <p class="muted small">Made ${fmtMoment(now())} by ${s.name}${s.deviceName ? ` on ${s.deviceName}` : ''} from MegaFauna Casebook.</p>
      </header>

      <section>
        <h2>Summary</h2>
        <table class="report-table"><tbody>
          ${[
            ['Type', CASE_TYPES[c.type]],
            ['Stage', STAGES[c.stage].label + (c.stage === 'closed' && c.outcome ? `: ${OUTCOMES[c.outcome]}` : '')],
            ['Priority', PRIORITIES[c.priority]],
            ['Incident', c.incidentDate ? `${fmtDate(c.incidentDate)}${c.incidentTime ? `, ${fmtTime(c.incidentTime)}` : ''}` : ''],
            ['Reported', c.reportedDate ? fmtDate(c.reportedDate) : ''],
            ['Place', [c.place, placeOf(c)].filter(Boolean).join(', ')],
            ['Map position', c.lat != null && c.lng != null ? `${c.lat}, ${c.lng}` : ''],
            ['Lead investigator', c.lead],
            ['Opened', fmtMoment(c.created)],
          ].filter((row) => row[1]).map((row) => html`<tr><th scope="row">${row[0]}</th><td>${row[1]}</td></tr>`)}
        </tbody></table>
        ${c.summary ? html`<div class="prose">${c.summary.split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}</div>` : ''}
      </section>

      ${k.animal.length ? html`<section>
        <h2>Animals</h2>
        <table class="report-table"><thead><tr><th>Animal</th><th>Condition</th><th>Description</th><th>Injuries or harm</th></tr></thead><tbody>
          ${k.animal.map((a) => html`<tr><td>${a.name ? `${a.name}, ` : ''}${SPECIES[a.species]}${a.count > 1 ? ` × ${a.count}` : ''}${a.sex !== 'unknown' ? `, ${SEXES[a.sex].toLowerCase()}` : ''}</td><td>${CONDITIONS[a.condition].label}</td><td>${a.description}</td><td>${a.injuries}</td></tr>`)}
        </tbody></table>
      </section>` : ''}

      <section>
        <h2>People</h2>
        ${people.length ? html`<table class="report-table"><thead><tr><th>Role</th><th>Name</th><th>Phone</th><th>Notes</th></tr></thead><tbody>
          ${people.map((p) => html`<tr><td>${ROLES[p.role].label}${p.confidential ? ' (confidential)' : ''}</td><td>${p.name}${p.address ? html`<br><span class="muted">${p.address}</span>` : ''}</td><td>${p.phone}</td><td>${p.notes}</td></tr>`)}
        </tbody></table>` : html`<p class="muted">None recorded${hidden ? '' : '.'}</p>`}
        ${hidden ? html`<p class="muted small">${plural(hidden, 'person', 'people')} marked confidential ${hidden === 1 ? 'is' : 'are'} left out of this report.</p>` : ''}
      </section>

      <section>
        <h2>Evidence</h2>
        ${k.evidence.length ? html`<table class="report-table evidence-table"><thead><tr><th>#</th><th>Evidence</th><th>Taken or collected</th><th>File and SHA-256 fingerprint</th></tr></thead><tbody>
          ${k.evidence.slice().reverse().map((e, i) => html`<tr>
            <td>${i + 1}</td>
            <td><strong>${e.title || e.fileName}</strong><br>${EVIDENCE_TYPES[e.type].label}${e.notes ? html`<br><span class="muted">${e.notes}</span>` : ''}</td>
            <td>${[e.capturedDate ? fmtDate(e.capturedDate) : '', e.capturedTime ? fmtTime(e.capturedTime) : ''].filter(Boolean).join(', ')}${e.capturedBy ? html`<br>by ${e.capturedBy}` : ''}${e.place ? html`<br>${e.place}` : ''}</td>
            <td>${e.sha256 ? html`${e.fileName} (${fmtNum(e.size)} bytes)<br><code class="hash">${e.sha256}</code><br><span class="muted">Added ${fmtMoment(e.created)}${e.createdBy ? ` by ${e.createdBy}` : ''}</span>` : 'Physical item, no file'}</td>
          </tr>`)}
        </tbody></table>
        <p class="muted small">Each fingerprint is the SHA-256 hash of the file, worked out when it was added to the Casebook. Working out the hash of the original file again, with any SHA-256 tool, gives the same value if the file hasn't changed.</p>` : html`<p class="muted">None recorded.</p>`}
      </section>

      ${legalRows.length ? html`<section>
        <h2>Legal</h2>
        <table class="report-table"><tbody>${legalRows.map((row) => html`<tr><th scope="row">${row[0]}</th><td>${row[1]}</td></tr>`)}</tbody></table>
      </section>` : ''}

      ${k.task.length ? html`<section>
        <h2>Tasks</h2>
        <ul class="report-list">${k.task.map((t) => html`<li>${t.done ? '☑' : '☐'} ${t.title}${t.due ? ` (due ${fmtDate(t.due)})` : ''}</li>`)}</ul>
      </section>` : ''}

      ${reportOptions.diary && k.entry.length ? html`<section>
        <h2>Diary</h2>
        <table class="report-table"><thead><tr><th>When</th><th>What</th></tr></thead><tbody>
          ${k.entry.slice().reverse().map((e) => html`<tr><td>${fmtDate(e.date)}${e.time ? html`<br>${fmtTime(e.time)}` : ''}<br><span class="muted">${ENTRY_TYPES[e.type].label}</span></td><td>${e.text.split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}<p class="muted">${e.createdBy}</p></td></tr>`)}
        </tbody></table>
      </section>` : ''}

      ${reportOptions.activity && k.log.length ? html`<section>
        <h2>Activity log</h2>
        <table class="report-table"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
          ${k.log.slice().reverse().map((e) => html`<tr><td>${fmtMoment(e.at)}</td><td>${e.by}${e.deviceName ? html`<br><span class="muted">${e.deviceName}</span>` : ''}</td><td>${e.text}</td></tr>`)}
        </tbody></table>
      </section>` : ''}
    </article>
  </div>`;
}

async function printReport(id) {
  const c = getCase(id);
  if (!c) return;
  await logOnly({ action: 'case.report', caseId: c.id, target: c.id, text: `Printed or saved the case report${reportOptions.confidential ? ', including confidential people' : ''}` });
  window.print();
}

/* Buttons ------------------------------------------------------------------- */

const ACTIONS = {
  skip() {
    main.focus();
  },
  lock() {
    lock('');
  },
  'close-sheet'() {
    closeSheet();
  },
  'sheet-delete'() {
    const options = currentSheet();
    if (options && options.onDelete) options.onDelete();
  },
  'toggle-pass'(el) {
    const input = document.getElementById(el.dataset.target);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.setAttribute('aria-pressed', String(show));
    el.setAttribute('aria-label', show ? 'Hide passphrase' : 'Show passphrase');
    setHTML(el, icon(show ? 'eye-off' : 'eye'));
  },
  'suggest-pass'(el) {
    const value = suggestPassphrase();
    for (const id of el.dataset.targets.split(' ')) {
      const input = document.getElementById(id);
      if (!input) continue;
      input.value = value;
      if (input.type === 'password') {
        input.type = 'text';
        const toggle = input.parentElement.querySelector('.pass-toggle');
        if (toggle) {
          toggle.setAttribute('aria-pressed', 'true');
          setHTML(toggle, icon('eye-off'));
        }
      }
      if (input.dataset.input === 'new-pass') updateStrength(input);
    }
  },
  forgot() {
    forgotSheet();
  },
  erase() {
    eraseCasebook();
  },
  'load-examples'() {
    run(loadExamples);
  },
  'remove-examples'() {
    run(removeExamples);
  },
  'filter-cases'(el) {
    Object.assign(caseFilter, { query: '', stage: 'open', type: '', city: '', flag: '' });
    const { filter, value } = el.dataset;
    if (filter === 'stage') caseFilter.stage = value;
    else if (filter === 'type') Object.assign(caseFilter, { type: value || '', stage: 'all' });
    else if (filter === 'urgent' || filter === 'hearing') caseFilter.flag = filter;
    navigate('#cases');
  },
  'clear-flag'() {
    caseFilter.flag = '';
    render();
  },
  'change-stage'(el) {
    changeStageSheet(el.dataset.id);
  },
  'delete-case'(el) {
    run(() => deleteCase(el.dataset.id));
  },
  'toggle-check'(el) {
    run(() => toggleChecklist(el));
  },
  'add-animal'(el) {
    animalSheet(el.dataset.case, null);
  },
  'edit-animal'(el) {
    const r = getRecord(el.dataset.id);
    if (r) animalSheet(r.caseId, r);
  },
  'add-person'(el) {
    personSheet(el.dataset.case, null);
  },
  'edit-person'(el) {
    const r = getRecord(el.dataset.id);
    if (r) personSheet(r.caseId, r);
  },
  'add-entry'(el) {
    entrySheet(el.dataset.case, null);
  },
  'edit-entry'(el) {
    const r = getRecord(el.dataset.id);
    if (r) entrySheet(r.caseId, r);
  },
  'add-task'(el) {
    taskSheet(el.dataset.case, null);
  },
  'edit-task'(el) {
    const r = getRecord(el.dataset.id);
    if (r) taskSheet(r.caseId, r);
  },
  'add-item'(el) {
    itemSheet(el.dataset.case, null);
  },
  'open-evidence'(el) {
    run(() => openEvidence(el.dataset.id));
  },
  'ev-view'(el) {
    run(() => viewEvidenceFile(el.dataset.id));
  },
  'ev-check'(el) {
    run(() => checkEvidence(el.dataset.id));
  },
  'ev-copy'(el) {
    run(() => saveEvidenceCopy(el.dataset.id));
  },
  'ev-custody'(el) {
    custodySheet(el.dataset.id);
  },
  'ev-edit'(el) {
    evidenceEditSheet(el.dataset.id);
  },
  'check-all'(el) {
    run(() => checkAll(el.dataset.case || ''));
  },
  copy(el) {
    copyText(el.dataset.copy, 'Copied');
  },
  locate(el) {
    locate(el);
  },
  'share-case'(el) {
    exportSheet(el.dataset.id);
  },
  export() {
    exportSheet('');
  },
  backup() {
    backupSheet();
  },
  'download-file'() {
    if (readyFile) downloadBlob(readyFile, readyFile.name);
  },
  'share-file'() {
    if (!readyFile) return;
    navigator.share({ files: [readyFile], title: readyFile.name }).catch((err) => {
      if (err && err.name !== 'AbortError') toast("Couldn't send it from here. Download it and send the file instead.");
    });
  },
  'print-report'(el) {
    run(() => printReport(el.dataset.id));
  },
  'verify-log'() {
    run(verifyLogSheet);
  },
  'change-pass'() {
    changePassSheet();
  },
  persist() {
    if (!navigator.storage || !navigator.storage.persist) return;
    navigator.storage.persist().then((granted) => {
      toast(granted ? 'The browser will keep the Casebook' : "The browser didn't agree. Installing the Casebook, or using it often, can help.");
      mountSettings();
    });
  },
  install() {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.finally(() => {
      installPrompt = null;
      render();
    });
  },
};

// Runs an action and reports anything that goes wrong.
function run(work) {
  Promise.resolve().then(work).catch((err) => {
    console.error(err);
    toast(messageFor(err));
  });
}

const FORMS = {
  setup: (form) => setUp(form),
  unlock: (form) => unlock(form),
  case: (form) => submitCase(form),
  legal: (form) => saveLegal(form),
  async sheet(form) {
    const options = currentSheet();
    if (!options || !options.onSubmit || form.dataset.busy) return;
    sheetError('');
    form.dataset.busy = '1';
    try {
      const result = await options.onSubmit(form);
      if (result === false) return;
      closeSheet();
      render();
    } catch (err) {
      console.error(err);
      sheetError(messageFor(err));
    } finally {
      delete form.dataset.busy;
    }
  },
};

/* Screens and navigation --------------------------------------------------- */

const VIEWS = {
  overview: { tab: 'overview', title: 'Overview', render: viewOverview, mount: () => applySizes(main) },
  cases: { tab: 'cases', title: 'Cases', render: viewCases },
  case: { tab: 'cases', title: 'Case', render: viewCase, mount: mountCase },
  'new-case': { tab: 'new', title: 'New case', render: viewCaseForm },
  'edit-case': { tab: 'cases', title: 'Edit case', render: viewCaseForm },
  evidence: { tab: 'evidence', title: 'Evidence', render: viewEvidence },
  share: { tab: 'share', title: 'Share', render: viewShare },
  settings: { tab: 'settings', title: 'Settings', render: viewSettings, mount: mountSettings },
  guide: { tab: 'settings', title: 'Investigation guide', render: viewGuide },
  report: { tab: 'cases', title: 'Case report', render: viewReport },
};

let routeHash = location.hash;
let current = null;
const scrollMemory = new Map();

function parseRoute(hash) {
  const [name, id, tab] = (hash || '').replace(/^#/, '').split('/');
  if (name === 'case' && isId(id)) return { name, id, tab: has(CASE_TABS, tab) ? tab : 'details' };
  if ((name === 'edit-case' || name === 'report') && isId(id)) return { name, id };
  if (has(VIEWS, name) && !['case', 'edit-case', 'report'].includes(name)) return { name };
  return { name: 'overview' };
}

function navigate(hash, replace) {
  routeHash = hash;
  try {
    if (replace) history.replaceState(null, '', hash);
    else if (location.hash !== hash) history.pushState(null, '', hash);
  } catch (err) {
    // Some embedded views block history changes. The app still works.
  }
  render({ focus: true, fresh: true });
}

function onHistoryChange() {
  if (location.hash === routeHash) return;
  routeHash = location.hash;
  closeAllDialogs();
  render({ focus: true, restoreScroll: true });
}

window.addEventListener('popstate', onHistoryChange);
window.addEventListener('hashchange', onHistoryChange);

function markTabs(tab) {
  document.querySelectorAll('[data-tab]').forEach((el) => {
    if (el.dataset.tab === tab) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

function render(options) {
  const opts = options || {};
  hideChartTip();
  document.body.classList.toggle('is-locked', !session);
  if (!session) {
    current = null;
    setHTML(main, storageProblem && !vaultExists ? viewUnsupported() : vaultExists ? viewLock() : viewSetup());
    document.title = 'MegaFauna Casebook';
    markTabs('');
    window.scrollTo(0, 0);
    const first = main.querySelector('input:not([type="checkbox"]):not([type="hidden"])');
    if (first && vaultExists) first.focus();
    else if (opts.focus) {
      const heading = main.querySelector('h1');
      if (heading) heading.focus({ preventScroll: true });
    }
    return;
  }
  const route = parseRoute(routeHash);
  const key = routeHash || '#overview';
  const changed = !current || current.key !== key || opts.fresh;
  if (current && current.key !== key) scrollMemory.set(current.key, window.scrollY);
  const view = VIEWS[route.name];
  setHTML(main, view.render(route));
  current = { key, name: route.name };
  // Generic titles only: the browser keeps page titles in its history.
  document.title = `${view.title} · MegaFauna Casebook`;
  markTabs(view.tab);
  if (view.mount) view.mount(route);
  if (changed) window.scrollTo(0, opts.restoreScroll ? scrollMemory.get(key) || 0 : 0);
  if (changed && opts.focus) {
    const heading = main.querySelector('h1');
    if (heading) heading.focus({ preventScroll: true });
  }
}

/* Events --------------------------------------------------------------------- */

document.addEventListener('click', (event) => {
  const actionEl = event.target instanceof Element ? event.target.closest('[data-action]') : null;
  if (actionEl && !actionEl.disabled) {
    const handler = ACTIONS[actionEl.dataset.action];
    if (handler) {
      if (actionEl.dataset.action === 'lock' || session || ['toggle-pass', 'suggest-pass', 'forgot', 'close-sheet', 'sheet-delete', 'skip', 'erase'].includes(actionEl.dataset.action)) {
        event.preventDefault();
        handler(actionEl, event);
      }
      return;
    }
  }
  const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  closeSheet();
  navigate(link.getAttribute('href'));
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  const handler = FORMS[form.dataset.form];
  if (!handler) return;
  event.preventDefault();
  Promise.resolve(handler(form)).catch((err) => {
    console.error(err);
    toast(messageFor(err));
  });
});

const refreshCasesSoon = debounce(refreshCaseResults, 120);
const refreshEvidenceSoon = debounce(() => {
  const box = document.getElementById('evidence-results');
  if (box) setHTML(box, evidenceResults());
}, 120);

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function onFieldEvent(event) {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  const kind = el.dataset.input;
  if (kind === 'new-pass') {
    updateStrength(el);
    return;
  }
  if (!session) return;
  if (kind === 'case-search' && event.type === 'input') {
    caseFilter.query = el.value;
    refreshCasesSoon();
  } else if (kind === 'evidence-search' && event.type === 'input') {
    evidenceFilter.query = el.value;
    refreshEvidenceSoon();
  } else if (kind === 'setting' && event.type === 'input') {
    onSettingInput(el);
  } else if (event.type !== 'change') {
    // Everything below happens once a choice is made.
  } else if (kind === 'case-filter') {
    caseFilter[el.dataset.key] = el.value;
    refreshCaseResults();
  } else if (kind === 'evidence-filter') {
    evidenceFilter.type = el.value;
    refreshEvidenceSoon();
  } else if (kind === 'evidence-files') {
    run(() => onEvidenceChosen(el));
  } else if (kind === 'import-file') {
    run(() => importChosen(el));
  } else if (kind === 'task-done') {
    run(() => toggleTask(el));
  } else if (kind === 'auto-lock') {
    run(() => saveSettings({ autoLock: Number(el.value) }).then(() => toast(`Locks after ${AUTO_LOCK[el.value]} without use`)));
  } else if (kind === 'lock-on-hide') {
    run(() => saveSettings({ lockOnHide: el.checked }));
  } else if (kind === 'report-option') {
    reportOptions[el.dataset.key] = el.checked;
    render();
  } else if (kind === 'stage-select') {
    document.getElementById('c-outcome-field').hidden = el.value !== 'closed';
  } else if (kind === 'stage-pill') {
    document.getElementById('sheet-outcome').hidden = el.value !== 'closed';
  } else if (kind === 'role-select') {
    const box = el.form.elements.confidential;
    if (box && has(ROLES, el.value)) box.checked = ROLES[el.value].confidential;
  } else if (kind === 'export-option' || el.name === 'scope') {
    updateExportSize(el.form);
  } else if (el.name === 'theme' && el.closest('.view')) {
    setTheme(el.value);
  }
}

document.addEventListener('input', onFieldEvent);
document.addEventListener('change', onFieldEvent);
document.addEventListener('cancel', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type === 'file') pickingFile = false;
}, true);

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  if (current && current.name === 'settings') render();
});

/* Start --------------------------------------------------------------------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;
  navigator.serviceWorker.register(scriptURL('sw.js')).catch(() => {
    // Offline use is a bonus; the Casebook works without it.
  });
}

async function start() {
  applyTheme(readTheme());
  // Inside another site's frame, clicks could be steered from outside.
  if (window.top !== window.self) {
    storageProblem = 'For safety, the Casebook only opens in its own window or tab.';
    render();
    return;
  }
  if (!store.supported() || !window.crypto || !crypto.subtle || !window.isSecureContext) {
    storageProblem = 'The Casebook needs secure storage and encryption, which this browser or this way of opening the page doesn’t provide.';
    render();
    return;
  }
  try {
    vaultExists = Boolean(await store.getMeta());
  } catch (err) {
    storageProblem = 'This browser won’t let the Casebook store anything. Private or incognito windows, and blocked site data, can cause this.';
  }
  render();
  registerServiceWorker();
}

start();
