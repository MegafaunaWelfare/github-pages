/* ==========================================================================
   MegaFauna Casebook: interface helpers
   Safe HTML, dates and numbers, and the dialogs. Nothing here knows about
   cases or keys.
   ========================================================================== */

/* Safe HTML ---------------------------------------------------------------- */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

// html`...` escapes every value it is given unless the value is already
// Safe, so text people type can never turn into markup.
export class Safe {
  constructor(text) { this.s = text; }
  toString() { return this.s; }
}
export const raw = (text) => new Safe(text);

function show(value) {
  if (value == null || value === false || value === true) return '';
  if (value instanceof Safe) return value.s;
  if (Array.isArray(value)) return value.map(show).join('');
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += show(values[i]) + strings[i + 1];
  return new Safe(out);
}

// The page's Content Security Policy turns on Trusted Types where the
// browser supports them: then this is the only way markup can be added, and
// only html`` output gets through. The only script it may load by address
// is the app's own service worker.
const policy = window.trustedTypes ? window.trustedTypes.createPolicy('casebook', {
  createHTML: (text) => text,
  createScriptURL(url) {
    if (url !== 'sw.js') throw new TypeError('Only the Casebook service worker may be loaded.');
    return url;
  },
}) : null;

export function setHTML(el, safe) {
  if (!(safe instanceof Safe)) throw new TypeError('setHTML takes html`` output only.');
  el.innerHTML = policy ? policy.createHTML(safe.s) : safe.s;
}

export const scriptURL = (url) => (policy ? policy.createScriptURL(url) : url);

export const checked = (on) => (on ? raw(' checked') : '');
export const selected = (on) => (on ? raw(' selected') : '');
export const icon = (name, className) => html`<svg class="icon${className ? ' ' + className : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function options(map, value, labelOf) {
  return Object.keys(map).map((key) => html`<option value="${key}"${selected(key === value)}>${labelOf ? labelOf(map[key]) : map[key]}</option>`);
}

export function radioPills(name, map, value, labelOf) {
  return html`<div class="pills">${Object.keys(map).map((key) => html`<label class="pill"><input type="radio" name="${name}" value="${key}"${checked(key === value)}><span>${labelOf ? labelOf(map[key]) : map[key]}</span></label>`)}</div>`;
}

/* Dates and numbers -------------------------------------------------------- */
// Dates are local 'YYYY-MM-DD' strings so they never shift with time zones;
// moments (when something was saved) are ISO timestamps.

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());
export const nowTime = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);

export function addDays(iso, n) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

const DATE_STYLES = {
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  short: { day: 'numeric', month: 'short' },
  month: { month: 'short', year: 'numeric' },
  monthOnly: { month: 'short' },
  long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
};

const validDate = (iso) => typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso);

export function fmtDate(iso, style) {
  if (!validDate(iso)) return '';
  return parseDate(iso).toLocaleDateString('en-IN', DATE_STYLES[style || 'medium']);
}

// "21 Oct" within this year, "21 Oct 2025" otherwise
export const fmtDay = (iso) => (validDate(iso) ? fmtDate(iso, iso.slice(0, 4) === today().slice(0, 4) ? 'short' : 'medium') : '');

export function fmtTime(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

// A saved moment in local time: "27 Oct 2026, 10:32 am"
export function fmtMoment(stamp) {
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return '';
  return `${fmtDate(isoDate(d))}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

export const localDate = (stamp) => {
  const d = new Date(stamp);
  return Number.isNaN(d.getTime()) ? '' : isoDate(d);
};

export function relDay(iso) {
  const n = daysBetween(today(), iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function relMoment(stamp) {
  const seconds = (Date.now() - new Date(stamp).getTime()) / 1000;
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return relDay(localDate(stamp));
}

export const fmtNum = (n) => Number(n).toLocaleString('en-IN');
export const plural = (n, one, many) => `${fmtNum(n)} ${n === 1 ? one : many || one + 's'}`;

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// "3fa9 1c2e … 8d07 c21b": enough to compare by eye
export const shortHash = (h) => (h ? `${h.slice(0, 4)} ${h.slice(4, 8)} … ${h.slice(-8, -4)} ${h.slice(-4)}` : '');
export const groupedHash = (h) => (h ? h.match(/.{1,8}/g).join(' ') : '');

export function listText(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* Dialogs ------------------------------------------------------------------ */

const sheet = document.getElementById('sheet');
const confirmDialog = document.getElementById('confirm');
const busyDialog = document.getElementById('busy');

let sheetOptions = null;
let sheetCleanups = [];

export const currentSheet = () => sheetOptions;

// options: title, body, submitLabel, onSubmit(form), onDelete, deleteLabel,
// onMount(form), wide, doneLabel. onSubmit returns false to stay open.
export function openSheet(options) {
  runSheetCleanups();
  sheetOptions = options;
  setHTML(sheet, html`<form class="sheet-form" data-form="sheet" novalidate autocomplete="off">
    <div class="sheet-head">
      <h2 id="sheet-title">${options.title}</h2>
      <button class="icon-btn" type="button" data-action="close-sheet" aria-label="Close">${icon('x')}</button>
    </div>
    <div class="sheet-body">
      ${options.body}
      <p class="error" id="sheet-error" role="alert" hidden></p>
    </div>
    <div class="sheet-foot">
      ${options.onDelete ? html`<button class="btn btn-danger" type="button" data-action="sheet-delete">${icon('trash')} ${options.deleteLabel || 'Delete'}</button>` : ''}
      <span class="spacer"></span>
      ${options.submitLabel
        ? html`<button class="btn btn-outline" type="button" data-action="close-sheet">Cancel</button>
          <button class="btn ${options.danger ? 'btn-danger-solid' : 'btn-primary'}" type="submit">${options.submitLabel}</button>`
        : html`<button class="btn btn-primary" type="button" data-action="close-sheet">${options.doneLabel || 'Done'}</button>`}
    </div>
  </form>`);
  sheet.classList.toggle('sheet-wide', Boolean(options.wide));
  sheet.setAttribute('aria-labelledby', 'sheet-title');
  const form = sheet.querySelector('form');
  if (!sheet.open) {
    if (typeof sheet.showModal === 'function') sheet.showModal();
    else sheet.setAttribute('open', '');
  }
  if (options.onMount) options.onMount(form);
  return form;
}

// Something to undo when the sheet closes, like a decrypted file's address.
export const onSheetClose = (fn) => sheetCleanups.push(fn);

function runSheetCleanups() {
  const list = sheetCleanups;
  sheetCleanups = [];
  for (const fn of list) {
    try {
      fn();
    } catch (err) {
      // Cleaning up is best effort.
    }
  }
}

export function closeSheet() {
  if (sheet.open) sheet.close();
}

sheet.addEventListener('close', () => {
  runSheetCleanups();
  setHTML(sheet, html``);
  sheetOptions = null;
});

// A tap on the dimmed area around the sheet closes it.
sheet.addEventListener('click', (event) => {
  if (event.target === sheet && !busyDialog.open) closeSheet();
});

export function sheetError(message) {
  const el = document.getElementById('sheet-error');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
  if (message) el.scrollIntoView({ block: 'nearest' });
}

// confirm() can't be styled or trusted to exist, so questions are asked here.
// typed: a word the person must type first, for things that can't be undone.
export function confirmAction({ title, text, confirmLabel, danger = true, typed = '' }) {
  return new Promise((resolve) => {
    setHTML(confirmDialog, html`<form class="confirm-form" method="dialog" autocomplete="off">
      <h2 id="confirm-title">${title}</h2>
      ${text ? html`<p>${text}</p>` : ''}
      ${typed ? html`<div class="field">
        <label for="confirm-typed">Type <strong>${typed}</strong> to confirm</label>
        <input id="confirm-typed" type="text" autocapitalize="characters" spellcheck="false">
      </div>` : ''}
      <div class="btn-row confirm-actions">
        <button class="btn btn-outline" value="cancel"${raw(typed ? '' : ' autofocus')}>Cancel</button>
        <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" value="ok"${raw(typed ? ' disabled' : '')}>${confirmLabel}</button>
      </div>
    </form>`);
    const okButton = confirmDialog.querySelector('button[value="ok"]');
    const typedInput = confirmDialog.querySelector('#confirm-typed');
    if (typedInput) {
      typedInput.addEventListener('input', () => {
        okButton.disabled = typedInput.value.trim().toUpperCase() !== typed;
      });
    }
    confirmDialog.returnValue = '';
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true });
    if (typeof confirmDialog.showModal === 'function') {
      confirmDialog.showModal();
      if (typedInput) typedInput.focus();
    } else resolve(false);
  });
}

export function closeConfirm() {
  if (confirmDialog.open) confirmDialog.close();
}

/* Waiting ------------------------------------------------------------------ */

const busyText = document.getElementById('busy-text');
const busyBar = document.getElementById('busy-bar');
let busyDepth = 0;

export const isBusy = () => busyDepth > 0;

// Runs work while a progress window blocks the page. work receives
// progress(done, total, text) to move the bar and change the message.
export async function withBusy(message, work) {
  busyDepth++;
  busyText.textContent = message;
  busyBar.removeAttribute('value');
  if (!busyDialog.open && typeof busyDialog.showModal === 'function') busyDialog.showModal();
  const progress = (done, total, text) => {
    if (text) busyText.textContent = text;
    if (total > 0) busyBar.value = Math.min(1, done / total);
    else busyBar.removeAttribute('value');
  };
  try {
    return await work(progress);
  } finally {
    busyDepth--;
    if (!busyDepth && busyDialog.open) busyDialog.close();
  }
}

// Esc mustn't close the progress window while work is still going.
busyDialog.addEventListener('cancel', (event) => event.preventDefault());

export function closeAllDialogs() {
  closeSheet();
  closeConfirm();
}

/* Messages ----------------------------------------------------------------- */

let toastTimer = 0;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 4000);
}

// Hides the message now and empties it once it has faded out.
export function clearToast() {
  clearTimeout(toastTimer);
  const el = document.getElementById('toast');
  el.classList.remove('is-visible');
  toastTimer = setTimeout(() => {
    el.textContent = '';
  }, 300);
}

export async function copyText(text, doneMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(doneMessage);
  } catch (err) {
    openSheet({
      title: 'Copy this',
      body: html`<p class="muted">Select the text below and copy it.</p>
        <label class="visually-hidden" for="copy-text">Text to copy</label>
        <textarea class="sheet-text" id="copy-text" readonly>${text}</textarea>`,
      onMount(form) {
        setTimeout(() => form.querySelector('textarea').select(), 50);
      },
    });
  }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Charts and bars get their sizes from data attributes, because the page's
// security policy doesn't allow inline style attributes.
export function applySizes(root) {
  root.querySelectorAll('[data-w]').forEach((el) => el.style.setProperty('--w', el.dataset.w));
  root.querySelectorAll('[data-h]').forEach((el) => el.style.setProperty('--h', el.dataset.h));
  root.querySelectorAll('[data-y]').forEach((el) => el.style.setProperty('--y', el.dataset.y));
}

/* Passphrases --------------------------------------------------------------- */

// Four made-up words like "bavek-tuson-midal-ferup": about 66 bits from
// crypto.getRandomValues, easy to read out over the phone.
const CONSONANTS = 'bdfghjklmnprstvz';
const VOWELS = 'aeiou';

function randomIndex(n) {
  const limit = 256 - (256 % n);
  const byte = new Uint8Array(1);
  do crypto.getRandomValues(byte); while (byte[0] >= limit);
  return byte[0] % n;
}

export function suggestPassphrase(words = 4) {
  const word = () => {
    let w = '';
    for (let i = 0; i < 5; i++) w += i % 2 ? VOWELS[randomIndex(VOWELS.length)] : CONSONANTS[randomIndex(CONSONANTS.length)];
    return w;
  };
  return Array.from({ length: words }, word).join('-');
}

const WEAK_PARTS = ['password', 'passphrase', 'megafauna', 'casebook', 'welfare', 'chandigarh', 'qwerty', 'letmein', '123456', 'abcdef'];

// A rough guide, not a guarantee. min: the shortest allowed.
export function passphraseStrength(value, min) {
  const text = String(value || '');
  if (!text) return { level: 0, label: '' };
  if (text.length < min) return { level: 0, label: `Too short: use at least ${min} characters`, block: true };
  const simple = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^(.)\1+$/.test(simple) || (text.length < 16 && WEAK_PARTS.some((w) => simple.includes(w)))) {
    return { level: 1, label: 'Too easy to guess', block: true };
  }
  const words = text.split(/[\s\-_.]+/).filter((w) => w.length >= 3).length;
  if (text.length >= 20 || (words >= 4 && text.length >= 16)) return { level: 3, label: 'Strong' };
  if (text.length >= 14) return { level: 2, label: 'Good' };
  return { level: 1, label: 'OK, but longer is safer' };
}
