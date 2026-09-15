import {MAX_BYTES} from './binary-reader.js';

export function decompress(bytes, size, kind) {
  // UnityFS uses raw, LZ4, and LZ4HC blocks. LZ4HC shares the same decoder format.
  if (size > MAX_BYTES) throw new Error('Decompressed data exceeds 512 MB');
  if (kind === 0) {
    if (bytes.length !== size) throw new Error('Uncompressed block size mismatch');
    return bytes;
  }
  if (kind !== 2 && kind !== 3) throw new Error(`Unsupported bundle compression ${kind}; supported: raw, LZ4, LZ4HC`);
  const output = new Uint8Array(size);
  let src = 0, dst = 0;
  const byte = () => { if (src >= bytes.length) throw new Error('Truncated LZ4 block'); return bytes[src++]; };
  const length = (base) => {
    if (base === 15) { let extra; do { extra = byte(); base += extra; } while (extra === 255); }
    return base;
  };
  while (src < bytes.length) {
    const token = byte(), literals = length(token >>> 4);
    if (src + literals > bytes.length || dst + literals > size) throw new Error('Invalid LZ4 literal length');
    output.set(bytes.subarray(src, src + literals), dst); src += literals; dst += literals;
    if (src === bytes.length) break;
    const offset = byte() | byte() << 8, match = length(token & 15) + 4;
    if (!offset || offset > dst || dst + match > size) throw new Error('Invalid LZ4 match');
    for (let i = 0; i < match; i++) { output[dst] = output[dst - offset]; dst++; }
  }
  if (dst !== size) throw new Error(`LZ4 size mismatch: ${dst} != ${size}`);
  return output;
}
