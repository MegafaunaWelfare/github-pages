/* ==========================================================================
   MegaFauna Casebook: when and where a photo was taken
   Reads the date and GPS position a camera writes into a JPEG (EXIF), so
   the evidence form can be filled in from the photo itself. Nothing else is
   read, and the photo is never changed.
   ========================================================================== */

const TAGS = { exif: 0x8769, gps: 0x8825, dateTime: 0x0132, taken: 0x9003, latRef: 0x0001, lat: 0x0002, lngRef: 0x0003, lng: 0x0004 };

function findExif(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return -1;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return -1;
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xda || length < 2) return -1;
    // APP1 starting "Exif\0\0"
    if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) return i + 10;
    i += 2 + length;
  }
  return -1;
}

function reader(bytes, start) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint16(start) === 0x4949;
  const inRange = (offset, size) => offset >= 0 && start + offset + size <= bytes.length;
  const u16 = (offset) => view.getUint16(start + offset, little);
  const u32 = (offset) => view.getUint32(start + offset, little);

  function entries(offset) {
    const out = new Map();
    if (!inRange(offset, 2)) return out;
    const count = u16(offset);
    for (let n = 0; n < count && n < 200; n++) {
      const at = offset + 2 + n * 12;
      if (!inRange(at, 12)) break;
      out.set(u16(at), { type: u16(at + 2), count: u32(at + 4), at: at + 8 });
    }
    return out;
  }

  function text(entry) {
    if (!entry || entry.type !== 2) return '';
    const where = entry.count > 4 ? u32(entry.at) : entry.at;
    if (!inRange(where, entry.count)) return '';
    let out = '';
    for (let k = 0; k < entry.count; k++) {
      const c = bytes[start + where + k];
      if (!c) break;
      out += String.fromCharCode(c);
    }
    return out;
  }

  function rationals(entry) {
    if (!entry || entry.type !== 5 || entry.count < 3) return null;
    const where = u32(entry.at);
    if (!inRange(where, 24)) return null;
    const values = [];
    for (let k = 0; k < 3; k++) {
      const den = u32(where + k * 8 + 4);
      values.push(den ? u32(where + k * 8) / den : NaN);
    }
    return values;
  }

  return { ok: inRange(0, 8) && u16(2) === 42, root: () => u32(4), entries, text, rationals, pointer: (entry) => (entry ? u32(entry.at) : -1) };
}

function parseTaken(value) {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(value);
  if (!m || m[1] === '0000') return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

function degrees(values, ref) {
  if (!values || values.some((v) => !Number.isFinite(v))) return null;
  const deg = values[0] + values[1] / 60 + values[2] / 3600;
  return ref === 'S' || ref === 'W' ? -deg : deg;
}

// Returns { date, time, lat, lng } with whatever the photo has, or null.
export async function readPhotoInfo(file) {
  if (!/^image\/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name || '')) return null;
  const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const start = findExif(bytes);
  if (start < 0) return null;
  const r = reader(bytes, start);
  if (!r.ok) return null;
  const ifd0 = r.entries(r.root());
  const exif = r.entries(r.pointer(ifd0.get(TAGS.exif)));
  const gps = r.entries(r.pointer(ifd0.get(TAGS.gps)));
  const taken = parseTaken(r.text(exif.get(TAGS.taken)) || r.text(ifd0.get(TAGS.dateTime)));
  const lat = degrees(r.rationals(gps.get(TAGS.lat)), r.text(gps.get(TAGS.latRef)));
  const lng = degrees(r.rationals(gps.get(TAGS.lng)), r.text(gps.get(TAGS.lngRef)));
  const info = {};
  if (taken) Object.assign(info, taken);
  if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) {
    info.lat = Math.round(lat * 1e6) / 1e6;
    info.lng = Math.round(lng * 1e6) / 1e6;
  }
  return Object.keys(info).length ? info : null;
}
