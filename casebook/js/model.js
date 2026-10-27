/* ==========================================================================
   MegaFauna Casebook: what a case file holds
   The words the Casebook uses, how every record is checked before it is
   trusted, how Casebook files from other people are combined, and the
   activity log.

   Everything is a flat record with an id and a kind: a case, or an animal,
   person, piece of evidence, diary entry or task belonging to one, or an
   entry in the activity log. Combining two copies of a case then means
   combining records one by one: the most recent change to each wins, and
   deleted records stay behind as empty markers ("tombstones") so a
   deletion travels to other copies instead of being undone by them.
   ========================================================================== */

import { toHex } from './sha256.js';

/* Words ------------------------------------------------------------------ */

export const CASE_TYPES = {
  beating: 'Beating or injury',
  poisoning: 'Poisoning',
  killing: 'Killing',
  sexual: 'Sexual abuse',
  neglect: 'Neglect',
  abandonment: 'Abandonment',
  relocation: 'Illegal relocation or capture',
  feeder: 'Harassment of feeders',
  road: 'Road accident or hit-and-run',
  transport: 'Illegal transport or slaughter',
  trade: 'Illegal breeding, sale or pet shop',
  working: 'Overworked or performing animals',
  other: 'Other',
};

// The order is the order a case usually moves in.
export const STAGES = {
  new: { label: 'New', hint: 'Reported, not looked into yet' },
  investigating: { label: 'Investigating', hint: 'Gathering evidence and statements' },
  complaint: { label: 'Complaint filed', hint: 'With the police or another authority' },
  court: { label: 'In court', hint: 'A case is before a court' },
  closed: { label: 'Closed', hint: 'Nothing more to do' },
};

export const OUTCOMES = {
  resolved: 'Resolved',
  convicted: 'Conviction or penalty',
  settled: 'Settled or undertaking given',
  noaction: 'No action taken by authorities',
  insufficient: 'Not enough evidence',
  withdrawn: 'Withdrawn',
  other: 'Other',
};

export const PRIORITIES = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const CITIES = {
  chandigarh: 'Chandigarh',
  mohali: 'Mohali',
  panchkula: 'Panchkula',
  zirakpur: 'Zirakpur',
  kharar: 'Kharar',
  other: 'Elsewhere',
};

export const SPECIES = {
  dog: 'Dog',
  cat: 'Cat',
  cattle: 'Cow, bull or calf',
  equine: 'Horse, donkey or mule',
  bird: 'Bird',
  monkey: 'Monkey',
  wild: 'Wild animal',
  other: 'Other',
};

export const SEXES = { female: 'Female', male: 'Male', unknown: 'Not known' };

export const CONDITIONS = {
  injured: { label: 'Injured', tone: 'bad' },
  sick: { label: 'Sick', tone: 'warn' },
  treated: { label: 'Being treated', tone: 'info' },
  recovered: { label: 'Recovered', tone: 'good' },
  died: { label: 'Died', tone: '' },
  missing: { label: 'Missing', tone: 'warn' },
  unharmed: { label: 'Not hurt', tone: 'good' },
  unknown: { label: 'Not known', tone: '' },
};

// confidential: whether a new person in this role starts out confidential.
// a: how the activity log names someone in this role.
export const ROLES = {
  reporter: { label: 'Reporter or complainant', plural: 'Reporters and complainants', a: 'a reporter', confidential: true },
  witness: { label: 'Witness', plural: 'Witnesses', a: 'a witness', confidential: true },
  caretaker: { label: 'Caretaker or owner', plural: 'Caretakers and owners', a: 'a caretaker', confidential: true },
  accused: { label: 'Accused or suspect', plural: 'Accused and suspects', a: 'an accused person', confidential: false },
  vet: { label: 'Vet', plural: 'Vets', a: 'a vet', confidential: false },
  police: { label: 'Police', plural: 'Police', a: 'a police officer', confidential: false },
  lawyer: { label: 'Lawyer', plural: 'Lawyers', a: 'a lawyer', confidential: false },
  official: { label: 'Official', plural: 'Officials', a: 'an official', confidential: false },
  other: { label: 'Other', plural: 'Others', a: 'a person', confidential: false },
};

export const EVIDENCE_TYPES = {
  photo: { label: 'Photo', icon: 'image' },
  video: { label: 'Video', icon: 'video' },
  audio: { label: 'Audio recording', icon: 'mic' },
  cctv: { label: 'CCTV footage', icon: 'cctv' },
  vet: { label: 'Vet or injury report', icon: 'vet' },
  postmortem: { label: 'Post-mortem report', icon: 'vet' },
  statement: { label: 'Written statement', icon: 'note' },
  fir: { label: 'Complaint or FIR copy', icon: 'scale' },
  document: { label: 'Other document', icon: 'file' },
  item: { label: 'Physical item', icon: 'box' },
  other: { label: 'Other', icon: 'file' },
};

export const ENTRY_TYPES = {
  note: { label: 'Note', icon: 'note' },
  visit: { label: 'Site visit', icon: 'pin' },
  call: { label: 'Call or message', icon: 'phone' },
  police: { label: 'Police', icon: 'shield' },
  vet: { label: 'Vet', icon: 'vet' },
  court: { label: 'Court', icon: 'scale' },
  meeting: { label: 'Meeting', icon: 'users' },
  other: { label: 'Other', icon: 'note' },
};

export const LEGAL_FIELDS = {
  policeStation: { label: 'Police station', max: 160 },
  complaintDate: { label: 'Complaint given to police on', date: true },
  firNumber: { label: 'FIR number', max: 60 },
  firDate: { label: 'FIR date', date: true },
  sections: { label: 'Sections of law', max: 300 },
  io: { label: 'Investigating officer', max: 120 },
  ioPhone: { label: 'Officer’s phone', max: 40 },
  otherComplaints: { label: 'Other complaints filed', max: 2000 },
  court: { label: 'Court', max: 160 },
  courtCase: { label: 'Court case number', max: 80 },
  nextHearing: { label: 'Next hearing', date: true },
  lawyer: { label: 'Lawyer', max: 120 },
  notes: { label: 'Legal notes', max: 8000 },
};

/* Small helpers ---------------------------------------------------------- */

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const oneOf = (value, options, fallback) => (typeof value === 'string' && has(options, value) ? value : fallback);
const str = (value, max) => (typeof value === 'string' ? value : value == null ? '' : String(value)).slice(0, max);
const bool = (value) => value === true;

function int(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const isTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const date = (value) => (isDate(value) ? value : '');
const time = (value) => (isTime(value) ? value : '');

// Timestamps are always full UTC ISO strings, so comparing them as text
// compares them in time.
function stamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export const now = () => new Date().toISOString();

function coord(value, limit) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 1e6) / 1e6 : null;
}

export function newId() {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

const isId = (value) => typeof value === 'string' && /^[a-z0-9]{8,40}$/.test(value);
const isHash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

// Case references like MWF-2026-K7QF. Random rather than counted, so two
// people opening cases on their own devices don't hand out the same one.
const REF_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRef(year) {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (b) => REF_LETTERS[b % REF_LETTERS.length]).join('');
  return `MWF-${year || new Date().getFullYear()}-${code}`;
}

/* Checking records ----------------------------------------------------------
   Every record passes through clean() on its way in, from the forms or from
   a Casebook file, so the rest of the app can trust its shape. Records that
   can't be trusted at all come back as null.
*/

export const CHILD_KINDS = ['animal', 'person', 'evidence', 'entry', 'task'];
export const KINDS = ['case', ...CHILD_KINDS, 'log', 'settings'];

function base(r, kind) {
  const created = stamp(r.created) || now();
  return {
    id: r.id,
    kind,
    created,
    createdBy: str(r.createdBy, 80),
    updated: stamp(r.updated) || created,
    updatedBy: str(r.updatedBy, 80),
    rev: int(r.rev, 1, 1e9, 1),
    example: bool(r.example),
  };
}

function tombstone(r) {
  const out = { id: r.id, kind: r.kind, deleted: true, updated: stamp(r.updated) || now(), updatedBy: str(r.updatedBy, 80), rev: int(r.rev, 1, 1e9, 1) };
  if (r.kind !== 'case' && isId(r.caseId)) out.caseId = r.caseId;
  if (bool(r.example)) out.example = true;
  return out;
}

function cleanLegal(legal) {
  const src = legal && typeof legal === 'object' ? legal : {};
  const out = {};
  for (const [key, field] of Object.entries(LEGAL_FIELDS)) out[key] = field.date ? date(src[key]) : str(src[key], field.max);
  return out;
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const t = str(tag, 40).trim();
    if (t && !seen.has(t.toLowerCase()) && out.length < 12) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

export const CHECKLIST = {
  photos: 'Photos or video of the animal',
  scene: 'Photos of the place',
  vet: 'Vet report (injuries or post-mortem)',
  witnesses: 'Witness details',
  cctv: 'CCTV footage asked for',
  complaint: 'Complaint given to the police',
  fir: 'Copy of the FIR',
  certificate: 'Certificate for electronic evidence (BSA s.63)',
};

function cleanChecklist(value) {
  const src = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const key of Object.keys(CHECKLIST)) if (src[key] === true) out[key] = true;
  return out;
}

const CLEANERS = {
  case(r) {
    return Object.assign(base(r, 'case'), {
      ref: str(r.ref, 40).trim() || `MWF-${r.id.slice(0, 6).toUpperCase()}`,
      title: str(r.title, 160),
      type: oneOf(r.type, CASE_TYPES, 'other'),
      stage: oneOf(r.stage, STAGES, 'new'),
      outcome: oneOf(r.outcome, OUTCOMES, ''),
      closedOn: date(r.closedOn),
      priority: oneOf(r.priority, PRIORITIES, 'normal'),
      incidentDate: date(r.incidentDate),
      incidentTime: time(r.incidentTime),
      reportedDate: date(r.reportedDate),
      city: oneOf(r.city, CITIES, ''),
      area: str(r.area, 120),
      place: str(r.place, 300),
      lat: coord(r.lat, 90),
      lng: coord(r.lng, 180),
      summary: str(r.summary, 20000),
      lead: str(r.lead, 80),
      tags: cleanTags(r.tags),
      checklist: cleanChecklist(r.checklist),
      legal: cleanLegal(r.legal),
    });
  },
  animal(r) {
    return Object.assign(base(r, 'animal'), {
      caseId: r.caseId,
      name: str(r.name, 80),
      species: oneOf(r.species, SPECIES, 'dog'),
      sex: oneOf(r.sex, SEXES, 'unknown'),
      count: int(r.count, 1, 9999, 1),
      condition: oneOf(r.condition, CONDITIONS, 'unknown'),
      description: str(r.description, 1000),
      injuries: str(r.injuries, 4000),
      notes: str(r.notes, 4000),
    });
  },
  person(r) {
    return Object.assign(base(r, 'person'), {
      caseId: r.caseId,
      role: oneOf(r.role, ROLES, 'other'),
      name: str(r.name, 120),
      phone: str(r.phone, 40),
      address: str(r.address, 300),
      notes: str(r.notes, 4000),
      confidential: bool(r.confidential),
    });
  },
  evidence(r) {
    const hasFile = isHash(r.sha256);
    const thumb = typeof r.thumb === 'string' && r.thumb.length <= 300000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.thumb) ? r.thumb : '';
    return Object.assign(base(r, 'evidence'), {
      caseId: r.caseId,
      type: oneOf(r.type, EVIDENCE_TYPES, 'other'),
      title: str(r.title, 200),
      notes: str(r.notes, 4000),
      capturedDate: date(r.capturedDate),
      capturedTime: time(r.capturedTime),
      capturedBy: str(r.capturedBy, 80),
      place: str(r.place, 300),
      fileName: hasFile ? str(r.fileName, 255) : '',
      mime: hasFile && typeof r.mime === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(r.mime) ? r.mime.slice(0, 100).toLowerCase() : '',
      size: hasFile ? int(r.size, 0, Number.MAX_SAFE_INTEGER, 0) : 0,
      sha256: hasFile ? r.sha256 : '',
      thumb: hasFile ? thumb : '',
    });
  },
  entry(r) {
    return Object.assign(base(r, 'entry'), {
      caseId: r.caseId,
      type: oneOf(r.type, ENTRY_TYPES, 'note'),
      date: date(r.date) || (stamp(r.created) || now()).slice(0, 10),
      time: time(r.time),
      text: str(r.text, 20000),
    });
  },
  task(r) {
    return Object.assign(base(r, 'task'), {
      caseId: r.caseId,
      title: str(r.title, 300),
      due: date(r.due),
      done: bool(r.done),
      doneOn: bool(r.done) ? date(r.doneOn) : '',
    });
  },
};

export function clean(r) {
  if (!r || typeof r !== 'object' || !isId(r.id) || !KINDS.includes(r.kind)) return null;
  if (r.kind === 'log') return cleanLog(r);
  if (r.kind === 'settings') return null;
  if (CHILD_KINDS.includes(r.kind) && !isId(r.caseId)) return null;
  if (r.deleted === true) return tombstone(r);
  return CLEANERS[r.kind](r);
}

/* Settings: kept with the records, encrypted, but never shared ------------ */

export const AUTO_LOCK = { 1: '1 minute', 2: '2 minutes', 5: '5 minutes', 10: '10 minutes', 15: '15 minutes', 30: '30 minutes', 60: '1 hour' };

export function cleanSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  return {
    id: 'settings',
    kind: 'settings',
    name: str(src.name, 80),
    deviceName: str(src.deviceName, 80),
    deviceId: isId(src.deviceId) ? src.deviceId : newId(),
    autoLock: has(AUTO_LOCK, String(src.autoLock)) ? Number(src.autoLock) : 10,
    lockOnHide: bool(src.lockOnHide),
    lastBackup: stamp(src.lastBackup),
    logSeq: int(src.logSeq, 0, 1e9, 0),
    logHead: isHash(src.logHead) ? src.logHead : '',
  };
}

/* Combining ---------------------------------------------------------------- */

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// Whether record a should replace record b: the later change wins. The
// revision count and then the content settle exact ties, so every copy of
// the Casebook picks the same winner whatever order files arrive in.
export function wins(a, b) {
  if (a.updated !== b.updated) return a.updated > b.updated;
  if ((a.rev || 0) !== (b.rev || 0)) return (a.rev || 0) > (b.rev || 0);
  return canonical(a) > canonical(b);
}

// Works out what combining incoming records into local ones would change.
// local: Map of id to record. Returns the records to write, the incoming
// records that lost to newer local ones, and counts by kind.
export function planMerge(local, incoming) {
  const put = [];
  const kept = [];
  const stats = {};
  const count = (kind, what) => {
    stats[kind] = stats[kind] || { added: 0, updated: 0, removed: 0, kept: 0, same: 0 };
    stats[kind][what]++;
  };
  const seen = new Set();
  for (const raw of incoming) {
    const rec = clean(raw);
    if (!rec || seen.has(rec.id)) continue;
    seen.add(rec.id);
    const cur = local.get(rec.id);
    if (rec.kind === 'log') {
      if (cur) count('log', 'same');
      else {
        put.push(rec);
        count('log', 'added');
      }
      continue;
    }
    if (!cur) {
      put.push(rec);
      count(rec.kind, rec.deleted ? 'removed' : 'added');
    } else if (cur.kind !== rec.kind) {
      count(rec.kind, 'kept');
      kept.push(rec);
    } else if (canonical(cur) === canonical(rec)) {
      count(rec.kind, 'same');
    } else if (wins(rec, cur)) {
      put.push(rec);
      count(rec.kind, rec.deleted && !cur.deleted ? 'removed' : 'updated');
    } else {
      count(rec.kind, 'kept');
      kept.push(rec);
    }
  }
  return { put, kept, stats };
}

// Chooses what goes into a Casebook file. caseIds: Set of case ids, or null
// for everything (a backup). Example records never leave the device.
export function selectForExport(records, { caseIds = null, confidential = true, files = true } = {}) {
  const chosen = [];
  const fileList = new Map();
  const cases = new Set();
  const examples = new Set();
  for (const r of records) {
    if (r.kind !== 'case') continue;
    if (r.example) examples.add(r.id);
    else if (!caseIds || caseIds.has(r.id)) cases.add(r.id);
  }
  for (const r of records) {
    if (r.example || r.kind === 'settings') continue;
    if (r.kind === 'case') {
      if (cases.has(r.id)) chosen.push(r);
    } else if (r.kind === 'log') {
      if (caseIds ? cases.has(r.caseId) : !examples.has(r.caseId)) chosen.push(r);
    } else if (cases.has(r.caseId) || (!caseIds && r.deleted)) {
      if (r.kind === 'person' && r.confidential && !confidential) continue;
      chosen.push(r);
      if (files && r.kind === 'evidence' && !r.deleted && r.sha256 && !fileList.has(r.sha256)) {
        fileList.set(r.sha256, { sha256: r.sha256, size: r.size });
      }
    }
  }
  return { records: chosen, files: Array.from(fileList.values()), cases: cases.size };
}

// The file list in a manifest comes from another device: only trust entries
// that look right and belong to evidence in the same file.
export function cleanFileList(files, records) {
  const wanted = new Map();
  for (const r of records) if (r && r.kind === 'evidence' && !r.deleted && isHash(r.sha256)) wanted.set(r.sha256, r.size);
  const out = [];
  const seen = new Set();
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || !isHash(f.sha256) || seen.has(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0) return null;
    seen.add(f.sha256);
    out.push({ sha256: f.sha256, size: f.size, wanted: wanted.get(f.sha256) === f.size });
  }
  return out;
}

/* Activity log ------------------------------------------------------------
   An append-only record of what was done, by whom and when. Each device
   numbers its own entries and links each one to the previous one by its
   SHA-256 hash, so an entry that is changed or removed later breaks the
   chain and shows up when the log is checked. Entries from other devices
   keep their own chains when files are combined.
*/

const LOG_FIELDS = ['id', 'kind', 'device', 'deviceName', 'seq', 'at', 'by', 'action', 'caseId', 'target', 'text', 'prev'];

function cleanLog(r) {
  const ok = isId(r.device)
    && Number.isInteger(r.seq) && r.seq >= 1
    && stamp(r.at) === r.at
    && typeof r.action === 'string' && /^[a-z.-]{1,40}$/.test(r.action)
    && typeof r.by === 'string' && r.by.length <= 80
    && typeof r.deviceName === 'string' && r.deviceName.length <= 80
    && typeof r.text === 'string' && r.text.length <= 500
    && (r.caseId === '' || isId(r.caseId))
    && (r.target === '' || isId(r.target))
    && (r.prev === '' || isHash(r.prev))
    && isHash(r.hash);
  if (!ok) return null;
  const out = {};
  for (const key of LOG_FIELDS) out[key] = r[key];
  out.hash = r.hash;
  return out;
}

export async function logHash(entry) {
  const body = {};
  for (const key of LOG_FIELDS) body[key] = entry[key];
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(body)));
  return toHex(new Uint8Array(digest));
}

// Makes the next entry in this device's chain.
export async function makeLogEntry(settings, fields) {
  const entry = {
    id: newId(),
    kind: 'log',
    device: settings.deviceId,
    deviceName: str(settings.deviceName, 80),
    seq: settings.logSeq + 1,
    at: now(),
    by: str(settings.name, 80),
    action: fields.action,
    caseId: fields.caseId || '',
    target: fields.target || '',
    text: str(fields.text, 500),
    prev: settings.logHead,
  };
  entry.hash = await logHash(entry);
  return entry;
}

// Checks every chain. own: { device, seq, head } for this device, whose
// chain must be complete; chains from other devices may have gaps, because
// a shared file only carries the entries about its cases.
export async function verifyLog(entries, own) {
  const byDevice = new Map();
  for (const e of entries) {
    if (!byDevice.has(e.device)) byDevice.set(e.device, []);
    byDevice.get(e.device).push(e);
  }
  if (own && own.seq > 0 && !byDevice.has(own.device)) byDevice.set(own.device, []);
  const devices = [];
  for (const [device, list] of byDevice) {
    list.sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : 1));
    const isOwn = Boolean(own && device === own.device);
    const report = { device, deviceName: '', entries: list.length, own: isOwn, changed: 0, broken: 0, forked: 0, missing: 0 };
    let last = null;
    for (const e of list) {
      report.deviceName = e.deviceName || report.deviceName;
      if (await logHash(e) !== e.hash) report.changed++;
      if (last && last.seq === e.seq) report.forked++;
      else if (last && last.seq + 1 === e.seq && e.prev !== last.hash) report.broken++;
      else if (isOwn && e.seq !== (last ? last.seq + 1 : 1)) report.missing += e.seq - (last ? last.seq + 1 : 1);
      else if (!last && e.seq === 1 && e.prev !== '') report.broken++;
      last = e;
    }
    if (isOwn) {
      const lastSeq = last ? last.seq : 0;
      if (own.seq > lastSeq) report.missing += own.seq - lastSeq;
      else if (last && own.head && last.hash !== own.head) report.broken++;
    }
    report.ok = !report.changed && !report.broken && !report.forked && !report.missing;
    devices.push(report);
  }
  devices.sort((a, b) => (b.own - a.own) || (b.entries - a.entries));
  return { ok: devices.every((d) => d.ok), entries: entries.length, devices };
}

/* Reading a case ------------------------------------------------------------ */

export const isOpen = (c) => c.stage !== 'closed';

export function checklist(c, children) {
  const evidence = children.filter((r) => r.kind === 'evidence');
  const hasType = (...types) => evidence.some((e) => types.includes(e.type));
  const auto = {
    photos: hasType('photo', 'video', 'cctv'),
    vet: hasType('vet', 'postmortem'),
    witnesses: children.some((r) => r.kind === 'person' && r.role === 'witness'),
    cctv: hasType('cctv'),
    complaint: Boolean(c.legal.complaintDate || c.legal.firNumber),
    fir: hasType('fir'),
  };
  return Object.keys(CHECKLIST).map((key) => ({
    key,
    label: CHECKLIST[key],
    auto: Boolean(auto[key]),
    done: Boolean(auto[key] || c.checklist[key]),
  }));
}
