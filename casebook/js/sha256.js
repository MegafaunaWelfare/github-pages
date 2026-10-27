/* ==========================================================================
   MegaFauna Casebook: SHA-256 fingerprints
   A streaming SHA-256, so an evidence file of any size can be fingerprinted
   a piece at a time. (crypto.subtle.digest needs the whole file in memory,
   which a long video on a phone may not fit in.)
   ========================================================================== */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

export class Sha256 {
  constructor() {
    this.state = Int32Array.from(H0);
    this.block = new Uint8Array(64);
    this.blockLength = 0;
    this.length = 0;
    this.w = new Int32Array(64);
    this.finished = false;
  }

  update(bytes) {
    if (this.finished) throw new Error('This fingerprint is already finished.');
    const n = bytes.length;
    let i = 0;
    this.length += n;
    if (this.blockLength) {
      i = Math.min(64 - this.blockLength, n);
      this.block.set(bytes.subarray(0, i), this.blockLength);
      this.blockLength += i;
      if (this.blockLength < 64) return this;
      this.compress(this.block, 0);
      this.blockLength = 0;
    }
    for (; i + 64 <= n; i += 64) this.compress(bytes, i);
    if (i < n) {
      this.block.set(bytes.subarray(i), 0);
      this.blockLength = n - i;
    }
    return this;
  }

  compress(bytes, offset) {
    const w = this.w;
    for (let t = 0; t < 16; t++) {
      const j = offset + t * 4;
      w[t] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    const s = this.state;
    let a = s[0], b = s[1], c = s[2], d = s[3], e = s[4], f = s[5], g = s[6], h = s[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    s[0] = (s[0] + a) | 0;
    s[1] = (s[1] + b) | 0;
    s[2] = (s[2] + c) | 0;
    s[3] = (s[3] + d) | 0;
    s[4] = (s[4] + e) | 0;
    s[5] = (s[5] + f) | 0;
    s[6] = (s[6] + g) | 0;
    s[7] = (s[7] + h) | 0;
  }

  // Returns the 32-byte fingerprint. The length is counted in bits, which
  // passes 2^32 for files over 512 MB, so it is split into two words.
  digest() {
    if (this.finished) throw new Error('This fingerprint is already finished.');
    const bits = this.length * 8;
    const block = this.block;
    block[this.blockLength++] = 0x80;
    if (this.blockLength > 56) {
      block.fill(0, this.blockLength);
      this.compress(block, 0);
      this.blockLength = 0;
    }
    block.fill(0, this.blockLength);
    const view = new DataView(block.buffer, block.byteOffset, 64);
    view.setUint32(56, Math.floor(bits / 0x100000000));
    view.setUint32(60, bits >>> 0);
    this.compress(block, 0);
    this.finished = true;
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outView.setInt32(i * 4, this.state[i]);
    return out;
  }
}

export function toHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export const sha256Hex = (bytes) => toHex(new Sha256().update(bytes).digest());

// Reads a Blob or File in slices, so only one slice is in memory at a time.
export async function fingerprintBlob(blob, onProgress, sliceSize = 4 * 1024 * 1024) {
  const hash = new Sha256();
  for (let offset = 0; offset < blob.size; offset += sliceSize) {
    const part = new Uint8Array(await blob.slice(offset, offset + sliceSize).arrayBuffer());
    hash.update(part);
    if (onProgress) onProgress(Math.min(blob.size, offset + sliceSize), blob.size);
  }
  return toHex(hash.digest());
}
